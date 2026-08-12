"""
Password hashing (bcrypt) and session tokens (JWT in an httpOnly cookie).

Cookie, not Authorization header: the WebSocket handshake in
routes/ws_runs.py is a plain HTTP Upgrade request, and browsers attach
cookies to it automatically for same-site requests -- there's no clean way
to attach a bearer header to a WebSocket handshake from client JS. One
auth mechanism that works for both REST and WS beats two mechanisms that
each work for one.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from app.core.config import get_settings

SESSION_COOKIE_NAME = "session"
_JWT_ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


def create_session_token(user_id: str, role: str) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "role": role,
        "iat": now,
        "exp": now + timedelta(minutes=settings.jwt_expire_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=_JWT_ALGORITHM)


def decode_session_token(token: str) -> dict | None:
    settings = get_settings()
    try:
        return jwt.decode(token, settings.jwt_secret_key, algorithms=[_JWT_ALGORITHM])
    except jwt.PyJWTError:
        return None
