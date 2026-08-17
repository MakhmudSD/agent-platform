"""
Manager + specialist nodes for the LangGraph rebuild.

The one thing worth understanding before touching this file: LangGraph's
interrupt() does NOT suspend a Python stack frame in place. When a run is
resumed, the node that called interrupt() is re-invoked from the top of the
function; interrupt() calls that already have a cached resume value return
it immediately instead of pausing again, but everything *before* the
interrupt() call in that node re-executes on every resume. Verified this
empirically (see the graph.py module docstring / dev notes) before relying
on it.

That means any node that writes to run_events and also calls interrupt()
would double-log on resume. So the two human-in-the-loop points are each
split into two nodes: a "do the work, decide we need input" node (intake,
draft) that has zero interrupt() calls and therefore never replays, and a
trivial "wait" node (await_message, interrupt_for_approval) whose entire
body is a single interrupt() call with no side effects — safe to replay
as many times as a resume requires, because there's nothing in it to
duplicate.
"""
from __future__ import annotations

import json

from langchain_core.runnables import RunnableConfig
from langgraph.types import interrupt
from sqlalchemy.orm import Session

from app.core.tracing import traced_node
from app.db.models import Run, RunStatus
from app.orchestrator.audit import log_event, notify
from app.orchestrator.graph_state import OrchestratorState
from app.orchestrator.vertical_employee_request import (
    APPROVAL_SUMMARY_SYSTEM_PROMPT, DRAFT_SYSTEM_PROMPT, ESCALATION_SYSTEM_PROMPT,
    GATHER_SYSTEM_PROMPT, REQUIRED_FIELDS,
)
from app.services.llm import structured_call
from app.services.retrieval import retrieve_policy

MANAGER_SYSTEM_PROMPT = """You are the manager of a small team handling an employee's \
internal request during the gathering phase. You never do the work yourself — you look at \
the current state and decide which specialist acts next, and you explain why in one sentence.

Specialists you can route to:
- "intake": gathers/clarifies draft fields from the employee. Choose this if draft_complete \
is false.
- "policy_research": retrieves relevant company policy for the draft. Choose this if \
draft_complete is true and (no policy has been retrieved yet, OR the last retrieval was \
judged not relevant and retrieval_attempts is less than 2).
- "draft": finalizes the request into a reviewable draft using retrieved policy. Choose this \
once policy has been retrieved and is judged relevant, or retrieval_attempts has reached 2.

Once a draft is finalized, routing to escalation, review, and approval is a fixed pipeline, \
not a decision you make -- you are never consulted again after choosing "draft".

Respond with JSON only:
{"next": "intake"|"policy_research"|"draft", "reasoning": "one sentence, specific to the state you were given"}
"""

RELEVANCE_SYSTEM_PROMPT = """You judge whether retrieved company policy excerpts are \
relevant enough to draft an employee request with confidence, or whether the search should \
be retried with a different query.

Respond with JSON only:
{"relevant": true|false, "refined_query": "..." (a better search query — required if \
relevant is false, omit or empty string otherwise)}
"""


def _draft_complete(draft: dict) -> bool:
    return all(draft.get(field) not in (None, "") for field in REQUIRED_FIELDS)


# ---------------------------------------------------------------------------
# manager
# ---------------------------------------------------------------------------

@traced_node("manager")
def manager_node(state: OrchestratorState, config: RunnableConfig) -> dict:
    db: Session = config["configurable"]["db"]
    run: Run = config["configurable"]["run"]

    context = {
        "draft": state["draft"],
        "draft_complete": _draft_complete(state["draft"]),
        "retrieval_attempts": state["retrieval_attempts"],
        "retrieved_policies_count": len(state["retrieved_policies"]),
        "policy_relevance": state.get("policy_relevance"),
        "status": state["status"],
    }
    result = structured_call(MANAGER_SYSTEM_PROMPT, json.dumps(context))
    next_node = result.get("next", "intake")
    reasoning = result.get("reasoning", "")

    # Deterministic safety net — never trust the LLM alone for a hard cap.
    # This is what verification item 3 (retry cap) is actually checking.
    if next_node == "policy_research" and state["retrieval_attempts"] >= 2:
        next_node = "draft"
        reasoning = (
            f"{reasoning} (overridden by hard cap: retrieval_attempts="
            f"{state['retrieval_attempts']} >= 2, proceeding to draft regardless.)"
        )

    log_event(db, run, "manager_decision", {"next": next_node, "reasoning": reasoning})
    return {"manager_target": next_node}


def route_from_manager(state: OrchestratorState) -> str:
    return state.get("manager_target", "intake")


# ---------------------------------------------------------------------------
# intake (work) + await_message (interrupt-only)
# ---------------------------------------------------------------------------

@traced_node("intake")
def intake_node(state: OrchestratorState, config: RunnableConfig) -> dict:
    db: Session = config["configurable"]["db"]
    run: Run = config["configurable"]["run"]

    # Every entry ever appended to messages (start_run's seed, await_message's
    # resume) has role "user" — there's no assistant/system role in this
    # graph's messages list, so the last entry is always the latest one.
    latest_message = state["messages"][-1]["content"] if state["messages"] else ""

    result = structured_call(
        GATHER_SYSTEM_PROMPT,
        f"Current draft: {state['draft']}\nLatest message from employee: {latest_message}",
    )
    draft = result.get("updated_draft", state["draft"])
    run.draft = draft
    log_event(db, run, "draft_updated", {"draft": draft})

    if result.get("ready_to_draft"):
        run.status = RunStatus.RETRIEVING
        log_event(db, run, "state_transition", {"to": RunStatus.RETRIEVING.value})
        return {"draft": draft, "status": RunStatus.RETRIEVING.value}

    question = result.get("next_question", "Could you clarify your request?")
    log_event(db, run, "clarifying_question_asked", {"question": question})
    return {"draft": draft, "pending_question": question}


def route_after_intake(state: OrchestratorState) -> str:
    return "manager" if state["status"] == RunStatus.RETRIEVING.value else "await_message"


@traced_node("await_message")
def await_message_node(state: OrchestratorState, config: RunnableConfig) -> dict:
    question = state.get("pending_question", "Could you clarify your request?")
    answer = interrupt({"kind": "clarifying_question", "question": question})

    # Runs exactly once per human turn, not on replay: everything before
    # interrupt() re-executes on resume, but this line only runs after the
    # resume value is already in hand, so it's safe to log here.
    db: Session = config["configurable"]["db"]
    run: Run = config["configurable"]["run"]
    log_event(db, run, "user_message", {"message": answer})

    return {"messages": state["messages"] + [{"role": "user", "content": answer}]}


# ---------------------------------------------------------------------------
# policy_research
# ---------------------------------------------------------------------------

@traced_node("policy_research")
def policy_research_node(state: OrchestratorState, config: RunnableConfig) -> dict:
    db: Session = config["configurable"]["db"]
    run: Run = config["configurable"]["run"]
    draft = state["draft"]

    query = state.get("next_query") or f"{draft.get('category', '')} {draft.get('justification', '')}"
    matches = retrieve_policy(db, query, top_k=2) if query.strip() else []
    # excerpt included so the live "policy checked" visual (rendered the
    # instant this event streams) can show the same evidence clause the
    # final approval card shows -- not just titles.
    log_event(db, run, "policy_retrieved", {
        "matches": [
            {"title": m.title, "doc_id": m.doc_id, "score": m.score, "excerpt": _excerpt(m.text)}
            for m in matches
        ]
    })

    policies = [
        {"title": m.title, "doc_id": m.doc_id, "score": m.score, "text": m.text}
        for m in matches
    ]
    attempts = state["retrieval_attempts"] + 1

    if not matches:
        # Nothing to judge — don't spend a call asking the model whether an
        # empty result set is "relevant" (it can and will say yes).
        relevant = False
        refined_query = None
    else:
        relevance_result = structured_call(
            RELEVANCE_SYSTEM_PROMPT,
            f"Draft: {draft}\nRetrieved excerpts:\n"
            + "\n\n".join(f"[{m.title}] {m.text}" for m in matches),
        )
        relevant = bool(relevance_result.get("relevant", True))
        refined_query = relevance_result.get("refined_query") or None

    return {
        "retrieved_policies": policies,
        "retrieval_attempts": attempts,
        "policy_relevance": "relevant" if relevant else "not_relevant",
        "next_query": refined_query,
    }


# ---------------------------------------------------------------------------
# draft
# ---------------------------------------------------------------------------

_EXCERPT_LIMIT = 280


def _excerpt(text: str) -> str:
    # A bare [:280] slice cuts off mid-word with no indicator it was
    # truncated -- reads as broken text, not an intentional preview.
    if len(text) <= _EXCERPT_LIMIT:
        return text
    return text[:_EXCERPT_LIMIT].rstrip() + "..."


_POLICY_RULE_STATUSES = {"passed", "binding", "outstanding"}


def _valid_policy_evaluation(raw: object, source_text: str) -> list[dict]:
    """Anti-hallucination guard on the model's policy_evaluation output --
    drops any entry whose status isn't one of the three the design defines,
    or whose "evidence" isn't actually traceable to the retrieved excerpt
    text (the model was told to quote, not paraphrase; this catches it
    when it doesn't). At most one "binding" rule survives, matching the
    design's "one teal element per card" rule."""
    if not isinstance(raw, list):
        return []
    normalized_source = " ".join(source_text.lower().split())
    seen_binding = False
    out: list[dict] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        rule, status, evidence = item.get("rule"), item.get("status"), item.get("evidence")
        if not (isinstance(rule, str) and isinstance(status, str) and isinstance(evidence, str)):
            continue
        if status not in _POLICY_RULE_STATUSES or not rule.strip() or not evidence.strip():
            continue
        normalized_evidence = " ".join(evidence.lower().split())
        if normalized_evidence not in normalized_source:
            continue
        if status == "binding":
            if seen_binding:
                status = "passed"
            seen_binding = True
        out.append({"rule": rule.strip(), "status": status, "evidence": evidence.strip()})
    return out


@traced_node("draft")
def draft_node(state: OrchestratorState, config: RunnableConfig) -> dict:
    db: Session = config["configurable"]["db"]
    run: Run = config["configurable"]["run"]

    run.status = RunStatus.DRAFTING
    log_event(db, run, "state_transition", {"to": RunStatus.DRAFTING.value})

    policy_excerpt_text = "\n\n".join(
        f"[{p['title']}]\n{p['text']}" for p in state["retrieved_policies"]
    ) or "(no matching policy found)"
    result = structured_call(
        DRAFT_SYSTEM_PROMPT,
        f"Draft fields: {state['draft']}\nRequester: {run.requester_name}\n\n"
        f"Policy excerpts:\n{policy_excerpt_text}",
    )
    final_draft = result.get("final_draft", state["draft"])
    final_draft["requester"] = run.requester_name
    run.draft = final_draft
    policy_evaluation = _valid_policy_evaluation(result.get("policy_evaluation"), policy_excerpt_text)
    log_event(db, run, "draft_finalized_for_review", {
        "draft": final_draft, "policy_notes": result.get("policy_notes", ""),
    })
    # Own event, not folded into draft_finalized_for_review -- keeps each
    # log_event single-purpose like the rest of this file, and gives the
    # rule checklist an event_type the frontend can key an inline visual
    # off of independently of the draft text.
    log_event(db, run, "policy_evaluated", {"policy_evaluation": policy_evaluation})

    # Status stays DRAFTING -- escalation_routing_node and
    # approval_summary_node still need to run before this request is
    # actually awaiting a human decision. That transition, and the
    # approval_requested event that goes with it, happens once in
    # approval_summary_node (the one node both the "approver" and
    # "reviewer" paths pass through), not here.
    return {"draft": final_draft, "policy_evaluation": policy_evaluation}


# ---------------------------------------------------------------------------
# escalation_routing (the Escalation/Routing Agent) + approval_summary (the
# Approval-Summary Agent, and the shared finalize step both paths go through)
# ---------------------------------------------------------------------------

_ROUTED_TO_VALUES = {"approver", "reviewer"}
_CONFIDENCE_VALUES = {"high", "medium", "low"}


def _valid_routing_decision(raw: object) -> dict:
    """Same anti-hallucination discipline as _valid_policy_evaluation, but
    the failure mode here is worse than a dropped card: an invalid value
    controls who is authorized to decide this request. Defaults to the
    conservative destination ("approver", the pre-existing behavior) on
    anything malformed, rather than ever silently escalating."""
    d = raw if isinstance(raw, dict) else {}
    routed_to = d.get("routed_to")
    if routed_to not in _ROUTED_TO_VALUES:
        routed_to = "approver"
    confidence = d.get("confidence")
    if confidence not in _CONFIDENCE_VALUES:
        confidence = "low"
    reason = d.get("reason")
    reason = reason.strip() if isinstance(reason, str) and reason.strip() else "No specific rule triggered escalation."
    triggered_rule = d.get("triggered_rule")
    triggered_rule = triggered_rule.strip() if isinstance(triggered_rule, str) and triggered_rule.strip() else None
    reviewer_category = d.get("reviewer_category")
    reviewer_category = reviewer_category.strip() if isinstance(reviewer_category, str) and reviewer_category.strip() else None
    if routed_to == "approver":
        reviewer_category = None
    return {
        "routed_to": routed_to, "reviewer_category": reviewer_category,
        "reason": reason, "confidence": confidence, "triggered_rule": triggered_rule,
    }


@traced_node("escalation_routing")
def escalation_routing_node(state: OrchestratorState, config: RunnableConfig) -> dict:
    """The Escalation/Routing Agent. Its output CONTRACT (this shape) is
    fixed -- approval_summary_node and the interrupt payload both depend on
    it. The routing LOGIC behind it (thresholds, which rule triggers
    escalation) is explicitly a spike: there's no real usage data yet on
    how often escalation should actually fire, so this reads real policy
    rule evaluation rather than hardcoded thresholds, and is expected to
    be revisited once a second vertical or real usage exists to validate
    against."""
    db: Session = config["configurable"]["db"]
    run: Run = config["configurable"]["run"]

    policy_evaluation = state.get("policy_evaluation", [])
    result = structured_call(
        ESCALATION_SYSTEM_PROMPT,
        f"Draft: {state['draft']}\nPolicy rule evaluation: {policy_evaluation}",
    )
    routing_decision = _valid_routing_decision(result)
    run.routed_to = routing_decision["routed_to"]
    log_event(db, run, "routing_decided", {"routing_decision": routing_decision})

    return {"routing_decision": routing_decision}


@traced_node("approval_summary")
def approval_summary_node(state: OrchestratorState, config: RunnableConfig) -> dict:
    """The Approval-Summary Agent -- but also the one finalize step both
    the "approver" and "reviewer" paths pass through, since a request
    genuinely becomes awaiting-a-human-decision here, not before. Only
    calls the LLM when routed to an approver: a Reviewer wants full
    context per case (see AgentVisualStack), not a condensed brief."""
    db: Session = config["configurable"]["db"]
    run: Run = config["configurable"]["run"]

    routing_decision = state.get("routing_decision") or {"routed_to": "approver"}
    approval_summary = None
    if routing_decision["routed_to"] == "approver":
        result = structured_call(
            APPROVAL_SUMMARY_SYSTEM_PROMPT,
            f"Draft: {state['draft']}\nPolicy rule evaluation: {state.get('policy_evaluation', [])}",
        )
        summary = result.get("summary")
        approval_summary = summary.strip() if isinstance(summary, str) and summary.strip() else None
        if approval_summary:
            log_event(db, run, "approval_summary_generated", {"approval_summary": approval_summary})

    citations = [
        {"title": p["title"], "excerpt": _excerpt(p["text"])}
        for p in state["retrieved_policies"]
    ]

    run.status = RunStatus.AWAITING_APPROVAL
    log_event(db, run, "state_transition", {"to": RunStatus.AWAITING_APPROVAL.value})
    # Same class of bug as the policy_citations gap fixed earlier (commits
    # 3cdf7fd/d533813): this payload is what a decider sees when they click
    # a run in from the queue instead of watching it live, so
    # routing_decision and approval_summary have to be here too, not just
    # in the interrupt() payload below.
    log_event(db, run, "approval_requested", {
        "draft": state["draft"], "policy_citations": citations,
        "policy_evaluation": state.get("policy_evaluation", []),
        "routing_decision": routing_decision, "approval_summary": approval_summary,
    })
    destination = "review" if routing_decision["routed_to"] == "reviewer" else "approval"
    notify(
        db, run,
        f"Awaiting {destination}: {run.requester_name}'s request "
        f"({state['draft'].get('category', 'request')}, ${state['draft'].get('amount', '?')}) needs your review.",
    )

    return {"status": RunStatus.AWAITING_APPROVAL.value, "approval_summary": approval_summary}


# ---------------------------------------------------------------------------
# interrupt_for_approval (interrupt-only) + apply_approval (work)
# ---------------------------------------------------------------------------

@traced_node("interrupt_for_approval")
def interrupt_for_approval_node(state: OrchestratorState, config: RunnableConfig) -> dict:
    citations = [
        {"title": p["title"], "excerpt": _excerpt(p["text"])}
        for p in state["retrieved_policies"]
    ]
    decision = interrupt({
        "kind": "approval_request", "draft": state["draft"], "policy_citations": citations,
        "policy_evaluation": state.get("policy_evaluation", []),
        "routing_decision": state.get("routing_decision"),
        "approval_summary": state.get("approval_summary"),
    })
    return {"approval_decision": decision}


@traced_node("apply_approval")
def apply_approval_node(state: OrchestratorState, config: RunnableConfig) -> dict:
    db: Session = config["configurable"]["db"]
    run: Run = config["configurable"]["run"]
    decision = state["approval_decision"]
    approved, reason = decision["approved"], decision.get("reason")
    approver_name = decision.get("approver_name")

    if approved:
        run.status = RunStatus.FINALIZED
        log_event(db, run, "approved", {"reason": reason, "approver_name": approver_name})
        log_event(db, run, "finalized", {"draft": run.draft})
        notify(
            db, run,
            f"Your request ({run.draft.get('category', 'request')}, "
            f"${run.draft.get('amount', '?')}) was approved.",
        )
        status = RunStatus.FINALIZED.value
    else:
        run.status = RunStatus.REJECTED
        log_event(db, run, "rejected", {"reason": reason, "approver_name": approver_name})
        notify(
            db, run,
            f"Your request ({run.draft.get('category', 'request')}, "
            f"${run.draft.get('amount', '?')}) was rejected.",
        )
        status = RunStatus.REJECTED.value

    return {"status": status}
