from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.models import Run
from app.db.session import get_db
from app.orchestrator import engine

router = APIRouter(prefix="/runs", tags=["runs"])


class StartRunRequest(BaseModel):
    requester_name: str
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


@router.post("")
def create_run(body: StartRunRequest, db: Session = Depends(get_db)):
    run, card = engine.start_run(db, body.requester_name, body.message)
    return {"run_id": run.id, "status": run.status, "card": card.model_dump()}


@router.post("/{run_id}/messages")
def send_message(run_id: str, body: MessageRequest, db: Session = Depends(get_db)):
    run = _get_run_or_404(db, run_id)
    card = engine.handle_message(db, run, body.message)
    return {"run_id": run.id, "status": run.status, "card": card.model_dump()}


@router.post("/{run_id}/approval")
def respond_to_approval(run_id: str, body: ApprovalRequest, db: Session = Depends(get_db)):
    run = _get_run_or_404(db, run_id)
    card = engine.handle_approval_response(db, run, body.approved, body.reason)
    return {"run_id": run.id, "status": run.status, "card": card.model_dump()}


@router.get("/{run_id}")
def get_run(run_id: str, db: Session = Depends(get_db)):
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
def list_runs(db: Session = Depends(get_db)):
    runs = db.query(Run).order_by(Run.created_at.desc()).limit(50).all()
    return [
        {"run_id": r.id, "status": r.status, "requester_name": r.requester_name,
         "created_at": r.created_at.isoformat()}
        for r in runs
    ]
