from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import can_decide, get_current_user, require_role
from app.db.models import Folder, Run, RunEvent, RunFeedback, User
from app.db.session import get_db
from app.orchestrator import graph

router = APIRouter(prefix="/runs", tags=["runs"])

# Local disk, not object storage -- matches this app's whole MVP posture
# (see seed.py's own "move to Alembic before this gets a second
# contributor" note). One directory per run keeps a run's attachments
# grouped and trivially found from its id alone.
UPLOAD_ROOT = Path(__file__).resolve().parent.parent / "data" / "uploads"
MAX_UPLOAD_BYTES = 10 * 1024 * 1024


class StartRunRequest(BaseModel):
    message: str


class MessageRequest(BaseModel):
    message: str


class ApprovalRequest(BaseModel):
    approved: bool
    reason: str | None = None


class FeedbackRequest(BaseModel):
    rating: bool
    note: str | None = None


class ArchiveRequest(BaseModel):
    archived: bool


class FolderAssignRequest(BaseModel):
    folder_id: str | None = None


def _get_run_or_404(db: Session, run_id: str) -> Run:
    run = db.get(Run, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return run


def _require_owner_or_admin(run: Run, user: User) -> None:
    # NULL user_id is NOT "unowned, anyone may act on it" -- it's also what
    # a run ends up with the moment its owner is deleted (admin.py's
    # delete_user relies on the FK's ON DELETE SET NULL). Treating NULL as
    # open would let any authenticated user, of any role, take over a
    # deleted user's in-flight runs. Only admin can act on an ownerless run.
    if run.user_id is None:
        if user.role.value != "admin":
            raise HTTPException(status_code=403, detail="Not your request")
        return
    if run.user_id != user.id and user.role.value != "admin":
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
    user: User = Depends(require_role("approver", "reviewer", "admin")), db: Session = Depends(get_db),
):
    run = _get_run_or_404(db, run_id)
    if not can_decide(run, user):
        raise HTTPException(status_code=403, detail="This request wasn't routed to you")
    card = graph.handle_approval_response(db, run, body.approved, body.reason, approver_name=user.name)
    return {"run_id": run.id, "status": run.status, "card": card.model_dump()}


@router.post("/{run_id}/feedback")
def submit_feedback(run_id: str, body: FeedbackRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    run = _get_run_or_404(db, run_id)
    # Anyone who was actually a participant in this conversation -- the
    # requester who ran it, or a decider it was routed to -- can rate it.
    # Not a general "rate anything" endpoint.
    is_participant = (run.user_id is not None and run.user_id == user.id) or can_decide(run, user)
    if not is_participant and user.role.value != "admin":
        raise HTTPException(status_code=403, detail="Not a participant in this conversation")

    existing = (
        db.query(RunFeedback)
        .filter(RunFeedback.run_id == run_id, RunFeedback.user_id == user.id)
        .first()
    )
    if existing is not None:
        existing.rating = body.rating
        existing.note = body.note
    else:
        db.add(RunFeedback(run_id=run_id, user_id=user.id, rating=body.rating, note=body.note))
    db.commit()
    return {"run_id": run_id, "rating": body.rating}


@router.get("/{run_id}/feedback")
def get_feedback(run_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _get_run_or_404(db, run_id)
    existing = (
        db.query(RunFeedback)
        .filter(RunFeedback.run_id == run_id, RunFeedback.user_id == user.id)
        .first()
    )
    return {"rating": existing.rating if existing else None}


@router.post("/{run_id}/attachments")
async def upload_attachment(run_id: str, file: UploadFile, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    run = _get_run_or_404(db, run_id)
    # Same participant check as feedback -- the requester who owns this
    # conversation, or a decider it was routed to, can attach a file to it.
    is_participant = (run.user_id is not None and run.user_id == user.id) or can_decide(run, user)
    if not is_participant and user.role.value != "admin":
        raise HTTPException(status_code=403, detail="Not a participant in this conversation")

    contents = await file.read()
    if len(contents) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File is too large (10MB max)")

    run_dir = UPLOAD_ROOT / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    stored_name = f"{uuid.uuid4()}_{file.filename}"
    (run_dir / stored_name).write_bytes(contents)
    url = f"/uploads/{run_id}/{stored_name}"

    # Logged as a real run_event, same append-only audit trail everything
    # else in this run goes through -- not a side table only the composer
    # knows about. This is what makes it show up for free in both the
    # live WS stream (audit_event) and a later replay (GET /runs/{id}).
    event = RunEvent(
        run_id=run_id, event_type="attachment_uploaded",
        payload={"filename": file.filename, "url": url, "size": len(contents), "uploaded_by": user.name},
    )
    db.add(event)
    db.commit()
    return {"filename": file.filename, "url": url, "size": len(contents)}


@router.patch("/{run_id}/archive")
def set_run_archived(run_id: str, body: ArchiveRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # Owner-only, same as folder assignment -- archiving is "hide this from
    # my own lists," which only makes sense for the person whose lists they
    # are. A decider archiving someone else's request wouldn't mean
    # anything real. Never touches run_events -- see Run.archived's
    # docstring in models.py.
    run = _get_run_or_404(db, run_id)
    _require_owner_or_admin(run, user)
    run.archived = body.archived
    db.commit()
    return {"run_id": run.id, "archived": run.archived}


@router.patch("/{run_id}/folder")
def set_run_folder(run_id: str, body: FolderAssignRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    run = _get_run_or_404(db, run_id)
    _require_owner_or_admin(run, user)
    if body.folder_id is not None:
        folder = db.get(Folder, body.folder_id)
        if folder is None or folder.user_id != user.id:
            raise HTTPException(status_code=404, detail="Folder not found")
    run.folder_id = body.folder_id
    db.commit()
    return {"run_id": run.id, "folder_id": run.folder_id}


@router.get("/{run_id}")
def get_run(run_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    run = _get_run_or_404(db, run_id)
    return {
        "run_id": run.id,
        "status": run.status,
        "requester_name": run.requester_name,
        "draft": run.draft,
        "routed_to": run.routed_to,
        "archived": run.archived,
        "folder_id": run.folder_id,
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
         "user_id": r.user_id, "routed_to": r.routed_to, "created_at": r.created_at.isoformat(),
         # updated_at is bumped by SQLAlchemy's onupdate on every write, so
         # for a terminal (finalized/rejected) run it's a real proxy for
         # "when it was decided" -- used client-side to compute an honest
         # typical-decision-time stat, not a new column or new query.
         "updated_at": r.updated_at.isoformat(),
         # Already-loaded column, not a new query -- lets the sidebar list
         # show what each request actually is (category/amount) instead of
         # N identical "name · status" rows.
         "draft": r.draft,
         "archived": r.archived,
         "folder_id": r.folder_id}
        for r in runs
    ]
