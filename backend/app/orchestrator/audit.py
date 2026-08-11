"""
Append-only writes to run_events. Shared by graph.py (run_started) and every
node in nodes.py, so there is exactly one place that knows how a RunEvent
row gets constructed.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.db.models import Run, RunEvent


def log_event(db: Session, run: Run, event_type: str, payload: dict) -> None:
    db.add(RunEvent(run_id=run.id, event_type=event_type, payload=payload))
