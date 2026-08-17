"""
Append-only writes to run_events, and notification rows. Shared by graph.py
(run_started) and every node in nodes.py, so there is exactly one place
that knows how a RunEvent or Notification row gets constructed.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.core import events
from app.db.models import Notification, Run, RunEvent


def log_event(db: Session, run: Run, event_type: str, payload: dict) -> None:
    db.add(RunEvent(run_id=run.id, event_type=event_type, payload=payload))
    # Live UI hint only -- fires before commit, same as the DB write it
    # mirrors is only flushed/committed later by graph.py's caller. Not the
    # audit trail's system of record; that's still run_events.
    events.emit(run.id, {"type": "audit_event", "event_type": event_type, "payload": payload})


def notify(
    db: Session, run: Run, message: str, *,
    type: str, user_id: str | None = None, target_role: str | None = None,
) -> None:
    """type is always required -- there is no untyped notification anymore.
    Exactly one of user_id (a specific person) / target_role (an open
    role-queue) should be set per call; see Notification's docstring for
    why they're different things, not the same column."""
    db.add(Notification(run_id=run.id, message=message, type=type, user_id=user_id, target_role=target_role))
