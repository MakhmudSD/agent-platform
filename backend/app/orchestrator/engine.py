"""
Generic orchestrator engine. Knows about states and transitions, nothing
about expenses or policies specifically — that lives in
vertical_employee_request.py and is imported here as data (prompts, field
list), not hardcoded logic.

Suspend/resume is real, not simulated: `awaiting_approval` is a row sitting
in Postgres, not a paused coroutine. The process can restart entirely and
`handle_approval_response` still works, because everything it needs is in
`runs.draft` and `run_events`, not in memory. This is the single most
important property to preserve — it's what separates this from a scripted
chatbot demo.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.db.models import Run, RunEvent, RunStatus
from app.orchestrator.cards import (
    ApprovalRequestCard, Card, ClarifyingQuestionCard, FinalConfirmationCard,
    PolicyCitationCard,
)
from app.orchestrator.vertical_employee_request import (
    DRAFT_SYSTEM_PROMPT, GATHER_SYSTEM_PROMPT,
)
from app.services.llm import structured_call
from app.services.retrieval import retrieve_policy


def _log(db: Session, run: Run, event_type: str, payload: dict) -> None:
    db.add(RunEvent(run_id=run.id, event_type=event_type, payload=payload))


def start_run(db: Session, requester_name: str, initial_message: str) -> tuple[Run, Card]:
    run = Run(requester_name=requester_name, status=RunStatus.GATHERING, draft={})
    db.add(run)
    db.flush()  # get run.id before logging
    _log(db, run, "run_started", {"initial_message": initial_message})
    card = _gather_step(db, run, initial_message)
    db.commit()
    return run, card


def handle_message(db: Session, run: Run, message: str) -> Card:
    """Called while status == GATHERING, after the human answers a clarifying question."""
    _log(db, run, "user_message", {"message": message})
    card = _gather_step(db, run, message)
    db.commit()
    return card


def _gather_step(db: Session, run: Run, latest_message: str) -> Card:
    result = structured_call(
        system_prompt=GATHER_SYSTEM_PROMPT,
        user_content=(
            f"Current draft: {run.draft}\n"
            f"Latest message from employee: {latest_message}"
        ),
    )
    run.draft = result.get("updated_draft", run.draft)
    _log(db, run, "draft_updated", {"draft": run.draft})

    if not result.get("ready_to_draft"):
        question = result.get("next_question", "Could you clarify your request?")
        _log(db, run, "clarifying_question_asked", {"question": question})
        return ClarifyingQuestionCard(question=question, field="unknown")

    return _move_to_drafting(db, run)


def _move_to_drafting(db: Session, run: Run) -> Card:
    run.status = RunStatus.RETRIEVING
    _log(db, run, "state_transition", {"to": RunStatus.RETRIEVING.value})

    query = f"{run.draft.get('category', '')} {run.draft.get('justification', '')}"
    matches = retrieve_policy(db, query, top_k=2) if query.strip() else []
    _log(db, run, "policy_retrieved", {
        "matches": [{"title": m.title, "doc_id": m.doc_id, "score": m.score} for m in matches]
    })

    run.status = RunStatus.DRAFTING
    _log(db, run, "state_transition", {"to": RunStatus.DRAFTING.value})

    policy_excerpt_text = "\n\n".join(f"[{m.title}]\n{m.text}" for m in matches) or "(no matching policy found)"
    result = structured_call(
        system_prompt=DRAFT_SYSTEM_PROMPT,
        user_content=f"Draft fields: {run.draft}\nRequester: {run.requester_name}\n\nPolicy excerpts:\n{policy_excerpt_text}",
    )
    final_draft = result.get("final_draft", run.draft)
    final_draft["requester"] = run.requester_name
    run.draft = final_draft
    _log(db, run, "draft_finalized_for_review", {"draft": final_draft, "policy_notes": result.get("policy_notes", "")})

    run.status = RunStatus.AWAITING_APPROVAL
    _log(db, run, "state_transition", {"to": RunStatus.AWAITING_APPROVAL.value})
    _log(db, run, "approval_requested", {"draft": final_draft})

    citations = [PolicyCitationCard(title=m.title, excerpt=m.text[:280]) for m in matches]
    return ApprovalRequestCard(draft=final_draft, policy_citations=citations)


def handle_approval_response(db: Session, run: Run, approved: bool, reason: str | None) -> Card:
    """
    This is the resume half of suspend/resume. `run` is loaded fresh from
    the DB by the caller — this function assumes nothing about process
    lifetime between the approval_requested event and this call.
    """
    if run.status != RunStatus.AWAITING_APPROVAL:
        raise ValueError(f"Run {run.id} is not awaiting approval (status={run.status})")

    if approved:
        run.status = RunStatus.FINALIZED
        _log(db, run, "approved", {"reason": reason})
        _log(db, run, "finalized", {"draft": run.draft})
        card = FinalConfirmationCard(status="finalized", draft=run.draft)
    else:
        run.status = RunStatus.REJECTED
        _log(db, run, "rejected", {"reason": reason})
        card = FinalConfirmationCard(status="rejected", draft=run.draft, reason=reason)

    db.commit()
    return card
