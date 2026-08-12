"""
Admin dashboard backend. Deliberately read-only for this pass -- role
mutation (promoting/demoting a user) is a privilege-escalation surface and
was scoped out explicitly rather than inferred from an ambiguous "go ahead
and apply" answer. Runs are visible via the existing GET /runs (already
returns everyone's runs, not just the caller's); this only adds what
didn't already exist: the user list.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.deps import require_role
from app.db.models import User
from app.db.session import get_db

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/users")
def list_users(user: User = Depends(require_role("admin")), db: Session = Depends(get_db)):
    users = db.query(User).order_by(User.created_at.desc()).all()
    return [
        {"id": u.id, "email": u.email, "name": u.name, "role": u.role.value, "created_at": u.created_at.isoformat()}
        for u in users
    ]
