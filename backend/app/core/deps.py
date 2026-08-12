"""
FastAPI dependencies for authenticated REST routes. WebSocket auth is
separate (routes/ws_runs.py reads the same cookie directly at connect time
-- FastAPI's dependency injection doesn't apply to the WS handshake the
way it does to HTTP routes) but decodes the same token via
core.security.decode_session_token, so both paths trust one source.
"""
from __future__ import annotations

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.core.security import SESSION_COOKIE_NAME, decode_session_token
from app.db.models import User
from app.db.session import get_db


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = decode_session_token(token)
    if payload is None:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    user = db.get(User, payload["sub"])
    if user is None:
        raise HTTPException(status_code=401, detail="User no longer exists")
    return user


def require_role(*roles: str):
    def dependency(user: User = Depends(get_current_user)) -> User:
        if user.role.value not in roles:
            raise HTTPException(status_code=403, detail=f"Requires role: {' or '.join(roles)}")
        return user

    return dependency
