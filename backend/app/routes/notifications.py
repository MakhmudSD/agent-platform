from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.db.models import Notification, User
from app.db.session import get_db

router = APIRouter(prefix="/notifications", tags=["notifications"])


def _visible_to(user: User):
    """Admin sees every row (its feed genuinely is 'all rows, no filter').
    Everyone else sees notifications addressed to them personally
    (user_id) or broadcast to their role's open queue (target_role) --
    see Notification's docstring for why those are two different columns,
    not one. Pre-migration rows with both NULL are invisible to everyone
    now rather than guessed at."""
    if user.role.value == "admin":
        return None
    return or_(Notification.user_id == user.id, Notification.target_role == user.role.value)


@router.get("")
def list_notifications(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    query = db.query(Notification)
    condition = _visible_to(user)
    if condition is not None:
        query = query.filter(condition)
    notifications = query.order_by(Notification.created_at.desc()).limit(100).all()
    return [
        {
            "id": n.id, "run_id": n.run_id, "message": n.message, "type": n.type,
            "read": n.read, "created_at": n.created_at.isoformat(),
        }
        for n in notifications
    ]


@router.post("/{notification_id}/read")
def mark_read(notification_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    notification = db.get(Notification, notification_id)
    if notification is None:
        raise HTTPException(status_code=404, detail="Notification not found")
    # Real gap this fixes: previously any authenticated user could mark
    # any notification read, including ones addressed to someone else --
    # only possible to check at all now that a real recipient exists.
    if user.role.value != "admin" and notification.user_id != user.id and notification.target_role != user.role.value:
        raise HTTPException(status_code=403, detail="Not your notification")
    notification.read = True
    db.commit()
    return {"id": notification.id, "read": notification.read}
