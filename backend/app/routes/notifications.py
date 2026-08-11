from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.models import Notification
from app.db.session import get_db

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("")
def list_notifications(db: Session = Depends(get_db)):
    notifications = (
        db.query(Notification).order_by(Notification.created_at.desc()).limit(100).all()
    )
    return [
        {
            "id": n.id, "run_id": n.run_id, "message": n.message,
            "read": n.read, "created_at": n.created_at.isoformat(),
        }
        for n in notifications
    ]


@router.post("/{notification_id}/read")
def mark_read(notification_id: str, db: Session = Depends(get_db)):
    notification = db.get(Notification, notification_id)
    if notification is None:
        raise HTTPException(status_code=404, detail="Notification not found")
    notification.read = True
    db.commit()
    return {"id": notification.id, "read": notification.read}
