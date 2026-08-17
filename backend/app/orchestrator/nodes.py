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
    DRAFT_SYSTEM_PROMPT, GATHER_SYSTEM_PROMPT, REQUIRED_FIELDS,
)
from app.services.llm import structured_call
from app.services.retrieval import retrieve_policy

MANAGER_SYSTEM_PROMPT = """You are the manager of a small team handling an employee's \
internal request. You never do the work yourself — you look at the current state and \
decide which specialist acts next, and you explain why in one sentence.

Specialists you can route to:
- "intake": gathers/clarifies draft fields from the employee. Choose this if draft_complete \
is false.
- "policy_research": retrieves relevant company policy for the draft. Choose this if \
draft_complete is true and (no policy has been retrieved yet, OR the last retrieval was \
judged not relevant and retrieval_attempts is less than 2).
- "draft": finalizes the request into a reviewable draft using retrieved policy. Choose this \
once policy has been retrieved and is judged relevant, or retrieval_attempts has reached 2.
- "interrupt_for_approval": choose this once status is "awaiting_approval" (a final draft \
already exists and is waiting on a human decision).
- "done": choose this only if status is already "finalized" or "rejected".

Respond with JSON only:
{"next": "intake"|"policy_research"|"draft"|"interrupt_for_approval"|"done", \
"reasoning": "one sentence, specific to the state you were given"}
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
    log_event(db, run, "policy_retrieved", {
        "matches": [{"title": m.title, "doc_id": m.doc_id, "score": m.score} for m in matches]
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
    log_event(db, run, "draft_finalized_for_review", {
        "draft": final_draft, "policy_notes": result.get("policy_notes", ""),
    })

    citations = [
        {"title": p["title"], "excerpt": _excerpt(p["text"])}
        for p in state["retrieved_policies"]
    ]

    run.status = RunStatus.AWAITING_APPROVAL
    log_event(db, run, "state_transition", {"to": RunStatus.AWAITING_APPROVAL.value})
    log_event(db, run, "approval_requested", {"draft": final_draft, "policy_citations": citations})
    notify(
        db, run,
        f"Awaiting approval: {run.requester_name}'s request "
        f"({final_draft.get('category', 'request')}, ${final_draft.get('amount', '?')}) needs your review.",
    )

    return {"draft": final_draft, "status": RunStatus.AWAITING_APPROVAL.value}


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
