from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.core.security import SESSION_COOKIE_NAME, create_session_token, hash_password, verify_password
from app.core.config import get_settings
from app.db.models import User, UserRole
from app.db.session import get_db

router = APIRouter(prefix="/auth", tags=["auth"])


class SignupRequest(BaseModel):
    email: EmailStr
    name: str
    password: str
    role: UserRole = UserRole.REQUESTER


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


def _user_out(user: User) -> dict:
    return {"id": user.id, "email": user.email, "name": user.name, "role": user.role.value}


def _set_session_cookie(response: Response, user: User) -> None:
    token = create_session_token(user.id, user.role.value)
    settings = get_settings()
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
        secure=False,  # dev over plain http -- flip to True behind HTTPS in production
        max_age=settings.jwt_expire_minutes * 60,
        path="/",
    )


@router.post("/signup")
def signup(body: SignupRequest, response: Response, db: Session = Depends(get_db)):
    if db.query(User).filter_by(email=body.email).first() is not None:
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    user = User(email=body.email, name=body.name, password_hash=hash_password(body.password), role=body.role)
    db.add(user)
    db.commit()
    db.refresh(user)
    _set_session_cookie(response, user)
    return _user_out(user)


@router.post("/login")
def login(body: LoginRequest, response: Response, db: Session = Depends(get_db)):
    user = db.query(User).filter_by(email=body.email).first()
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    _set_session_cookie(response, user)
    return _user_out(user)


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(SESSION_COOKIE_NAME, path="/")
    return {"ok": True}


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return _user_out(user)
