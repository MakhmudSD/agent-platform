from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, require_role
from app.db.models import Run, User
from app.db.session import get_db
from app.orchestrator import graph

router = APIRouter(prefix="/runs", tags=["runs"])


class StartRunRequest(BaseModel):
    message: str


class MessageRequest(BaseModel):
    message: str


class ApprovalRequest(BaseModel):
    approved: bool
    reason: str | None = None


def _get_run_or_404(db: Session, run_id: str) -> Run:
    run = db.get(Run, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return run


def _require_owner_or_admin(run: Run, user: User) -> None:
    # Legacy rows created before auth existed have no user_id -- treat them
    # as unowned rather than locking them out entirely.
    if run.user_id is not None and run.user_id != user.id and user.role.value != "admin":
        raise HTTPException(status_code=403, detail="Not your request")


@router.post("")
def create_run(body: StartRunRequest, user: User = Depends(require_role("requester", "admin")), db: Session = Depends(get_db)):
    # requester_name/user_id come from the authenticated session, never the
    # request body -- a client-supplied name would let anyone submit a
    # request "as" someone else.
    run, card = graph.start_run(db, user.name, body.message, user_id=user.id)
    return {"run_id": run.id, "status": run.status, "card": card.model_dump()}


@router.post("/{run_id}/messages")
def send_message(run_id: str, body: MessageRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    run = _get_run_or_404(db, run_id)
    _require_owner_or_admin(run, user)
    card = graph.handle_message(db, run, body.message)
    return {"run_id": run.id, "status": run.status, "card": card.model_dump()}


@router.post("/{run_id}/approval")
def respond_to_approval(
    run_id: str, body: ApprovalRequest,
    user: User = Depends(require_role("approver", "admin")), db: Session = Depends(get_db),
):
    run = _get_run_or_404(db, run_id)
    card = graph.handle_approval_response(db, run, body.approved, body.reason)
    return {"run_id": run.id, "status": run.status, "card": card.model_dump()}


@router.get("/{run_id}")
def get_run(run_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    run = _get_run_or_404(db, run_id)
    return {
        "run_id": run.id,
        "status": run.status,
        "requester_name": run.requester_name,
        "draft": run.draft,
        "events": [
            {"type": e.event_type, "payload": e.payload, "created_at": e.created_at.isoformat()}
            for e in run.events
        ],
    }


@router.get("")
def list_runs(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    runs = db.query(Run).order_by(Run.created_at.desc()).limit(50).all()
    return [
        {"run_id": r.id, "status": r.status, "requester_name": r.requester_name,
         "created_at": r.created_at.isoformat()}
        for r in runs
    ]
