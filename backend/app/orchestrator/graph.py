"""
Compiles the manager + specialist graph and exposes the same three
operations engine.py used to (start_run, handle_message,
handle_approval_response) — routes/runs.py calls these exactly as it
called engine.py's before, so the API contract (request/response shapes)
doesn't move at all; only what's behind it does.

Two persistence layers, deliberately not merged:

- `runs` / `run_events` (SQLAlchemy, same tables as before) are the
  client-facing system of record. Every node writes to them explicitly,
  same as engine.py's functions did. This is what GET /runs and
  GET /runs/{id} still read, unchanged.

- LangGraph's PostgresSaver checkpointer is purely internal resume state —
  it's what lets interrupt_for_approval and await_message actually pause
  graph execution and pick back up in a later, unrelated HTTP request
  (verified this works across separate Python processes, not just
  separate function calls in-process, before wiring it in for real).
  Nothing outside this module reads the checkpointer; it is not a
  substitute for run_events and doesn't try to be.
"""
from __future__ import annotations

from typing import Callable

from langgraph.checkpoint.postgres import PostgresSaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.tracing import tracer
from app.db.models import Run, RunStatus
from app.orchestrator.audit import log_event
from app.orchestrator.cards import (
    ApprovalRequestCard, Card, ClarifyingQuestionCard, FinalConfirmationCard,
    PolicyCitationCard, PolicyRuleCard,
)
from app.orchestrator.graph_state import OrchestratorState
from app.orchestrator.nodes import (
    apply_approval_node, await_message_node, draft_node,
    intake_node, interrupt_for_approval_node, manager_node,
    policy_research_node, route_after_intake, route_from_manager,
)

# FastAPI dispatches sync route handlers to its threadpool, so concurrent
# requests genuinely run graph.invoke() in parallel OS threads. A single
# raw psycopg connection is not safe for that — pool it instead so each
# concurrent invoke() checks out its own connection.
_checkpointer_pool = ConnectionPool(
    conninfo=get_settings().database_url,
    max_size=10,
    kwargs={"autocommit": True, "row_factory": dict_row},
    open=True,
)
_checkpointer = PostgresSaver(_checkpointer_pool)
_checkpointer.setup()


def _build_graph():
    g = StateGraph(OrchestratorState)
    g.add_node("manager", manager_node)
    g.add_node("intake", intake_node)
    g.add_node("await_message", await_message_node)
    g.add_node("policy_research", policy_research_node)
    g.add_node("draft", draft_node)
    g.add_node("interrupt_for_approval", interrupt_for_approval_node)
    g.add_node("apply_approval", apply_approval_node)

    g.add_edge(START, "manager")
    g.add_conditional_edges(
        "manager",
        route_from_manager,
        {
            "intake": "intake",
            "policy_research": "policy_research",
            "draft": "draft",
            "interrupt_for_approval": "interrupt_for_approval",
            "done": END,
        },
    )
    g.add_conditional_edges(
        "intake", route_after_intake, {"manager": "manager", "await_message": "await_message"}
    )
    g.add_edge("await_message", "intake")
    g.add_edge("policy_research", "manager")
    g.add_edge("draft", "manager")
    g.add_edge("interrupt_for_approval", "apply_approval")
    g.add_edge("apply_approval", END)

    return g.compile(checkpointer=_checkpointer)


_graph = _build_graph()


def _config_for(db: Session, run: Run) -> dict:
    return {
        "configurable": {"thread_id": run.id, "db": db, "run": run},
        # Safety net: the manager's hard cap on retrieval_attempts is the real
        # guarantee against infinite loops, but this bounds worst-case damage
        # from any future routing bug to a clear error instead of a hang.
        "recursion_limit": 50,
    }


def _card_from_interrupt(payload: dict) -> Card:
    kind = payload.get("kind")
    if kind == "clarifying_question":
        return ClarifyingQuestionCard(question=payload["question"], field="unknown")
    if kind == "approval_request":
        citations = [PolicyCitationCard(**c) for c in payload.get("policy_citations", [])]
        evaluation = [PolicyRuleCard(**e) for e in payload.get("policy_evaluation", [])]
        return ApprovalRequestCard(draft=payload["draft"], policy_citations=citations, policy_evaluation=evaluation)
    raise ValueError(f"Unrecognized interrupt payload kind: {kind!r} in {payload!r}")


def _card_from_final_state(run: Run, result: dict) -> Card:
    if run.status == RunStatus.FINALIZED:
        return FinalConfirmationCard(status="finalized", draft=run.draft)
    if run.status == RunStatus.REJECTED:
        reason = (result.get("approval_decision") or {}).get("reason")
        return FinalConfirmationCard(status="rejected", draft=run.draft, reason=reason)
    raise ValueError(f"Graph completed without interrupting in unexpected status: {run.status}")


def _run_and_translate(db: Session, run: Run, invoke_input) -> Card:
    with tracer.start_as_current_span("graph.invoke") as span:
        span.set_attribute("run.id", run.id)
        result = _graph.invoke(invoke_input, _config_for(db, run))
    db.commit()

    interrupts = result.get("__interrupt__")
    if interrupts:
        return _card_from_interrupt(interrupts[0].value)

    db.refresh(run)
    return _card_from_final_state(run, result)


def start_run(
    db: Session,
    requester_name: str,
    initial_message: str,
    on_run_created: Callable[[Run], None] | None = None,
    user_id: str | None = None,
) -> tuple[Run, Card]:
    run = Run(requester_name=requester_name, status=RunStatus.GATHERING, draft={}, user_id=user_id)
    db.add(run)
    db.flush()  # get run.id before logging / using it as the graph thread_id
    if on_run_created:
        # Lets a caller (the WS route) register a live-event sink for this
        # run's id before any node runs and starts emitting -- run.id isn't
        # known until this point, so it can't be registered any earlier.
        on_run_created(run)
    log_event(db, run, "run_started", {"initial_message": initial_message})

    initial_state: OrchestratorState = {
        "run_id": run.id,
        "requester_name": requester_name,
        "draft": {},
        "messages": [{"role": "user", "content": initial_message}],
        "retrieval_attempts": 0,
        "retrieved_policies": [],
        "status": RunStatus.GATHERING.value,
    }
    card = _run_and_translate(db, run, initial_state)
    return run, card


def handle_message(db: Session, run: Run, message: str) -> Card:
    """Resumes a graph paused at await_message (mid-gathering clarifying loop)."""
    if run.status != RunStatus.GATHERING:
        raise ValueError(f"Run {run.id} is not awaiting a message (status={run.status})")
    return _run_and_translate(db, run, Command(resume=message))


def handle_approval_response(
    db: Session, run: Run, approved: bool, reason: str | None, approver_name: str | None = None,
) -> Card:
    """Resumes a graph paused at interrupt_for_approval."""
    if run.status != RunStatus.AWAITING_APPROVAL:
        raise ValueError(f"Run {run.id} is not awaiting approval (status={run.status})")
    return _run_and_translate(
        db, run, Command(resume={"approved": approved, "reason": reason, "approver_name": approver_name}),
    )
