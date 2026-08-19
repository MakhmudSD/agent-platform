"""
Admin dashboard backend. User management (create/update role/delete) was
deliberately scoped out of an earlier pass -- role mutation is a
privilege-escalation surface -- but was explicitly asked for and confirmed
afterward. The two lockout paths that scoping-out was protecting against
are guarded directly rather than left to "just be careful": an admin can't
change their own role away from admin, and can't delete/demote the last
remaining admin account. Runs are visible via the existing GET /runs
(already returns everyone's runs, not just the caller's); this only adds
what didn't already exist: user management.
"""
from __future__ import annotations

from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.deps import require_role
from app.core.security import hash_password
from app.db.models import Run, RunEvent, RunFeedback, User, UserRole
from app.db.session import get_db

router = APIRouter(prefix="/admin", tags=["admin"])


def _user_out(u: User) -> dict:
    return {"id": u.id, "email": u.email, "name": u.name, "role": u.role.value, "created_at": u.created_at.isoformat()}


def _admin_count(db: Session) -> int:
    return db.query(User).filter(User.role == UserRole.ADMIN).count()


@router.get("/users")
def list_users(user: User = Depends(require_role("admin")), db: Session = Depends(get_db)):
    users = db.query(User).order_by(User.created_at.desc()).all()
    return [_user_out(u) for u in users]


class CreateUserRequest(BaseModel):
    email: EmailStr
    name: str
    password: str = Field(min_length=8)
    role: UserRole = UserRole.REQUESTER


@router.post("/users", status_code=201)
def create_user(
    body: CreateUserRequest, user: User = Depends(require_role("admin")), db: Session = Depends(get_db)
):
    if db.query(User).filter_by(email=body.email).first() is not None:
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    new_user = User(email=body.email, name=body.name, password_hash=hash_password(body.password), role=body.role)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return _user_out(new_user)


class UpdateUserRequest(BaseModel):
    name: str | None = None
    role: UserRole | None = None


@router.patch("/users/{user_id}")
def update_user(
    user_id: str,
    body: UpdateUserRequest,
    user: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    if body.role is not None and body.role != target.role:
        if target.id == user.id:
            raise HTTPException(status_code=400, detail="You can't change your own role")
        if target.role == UserRole.ADMIN and _admin_count(db) <= 1:
            raise HTTPException(status_code=400, detail="Can't demote the last remaining admin")
        target.role = body.role
    if body.name is not None:
        target.name = body.name
    db.commit()
    db.refresh(target)
    return _user_out(target)


@router.delete("/users/{user_id}")
def delete_user(user_id: str, user: User = Depends(require_role("admin")), db: Session = Depends(get_db)):
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    if target.id == user.id:
        raise HTTPException(status_code=400, detail="You can't delete your own account")
    if target.role == UserRole.ADMIN and _admin_count(db) <= 1:
        raise HTTPException(status_code=400, detail="Can't delete the last remaining admin")
    db.delete(target)
    db.commit()
    return {"deleted": True}


@router.get("/feedback")
def list_feedback(user: User = Depends(require_role("admin")), db: Session = Depends(get_db)):
    """
    Every thumbs up/down left on a resolved conversation (ConversationFeedback.tsx,
    one row per run+rater via POST /runs/{id}/feedback) -- previously only
    queryable by hitting Postgres directly, same gap /admin/usage closed for
    token spend. `note` is in the schema but no UI writes it yet, so it's
    null on every row today; still returned since a future feedback form
    wouldn't need a backend change to show up here.
    """
    rows = (
        db.query(RunFeedback, Run, User)
        .join(Run, RunFeedback.run_id == Run.id)
        .join(User, RunFeedback.user_id == User.id)
        .order_by(RunFeedback.created_at.desc())
        .all()
    )
    return [
        {
            "id": fb.id,
            "run_id": fb.run_id,
            "rating": fb.rating,
            "note": fb.note,
            "created_at": fb.created_at.isoformat(),
            "rater_name": rater.name,
            "rater_role": rater.role.value,
            "run_status": run.status.value,
            "run_requester_name": run.requester_name,
            "run_category": (run.draft or {}).get("category"),
        }
        for fb, run, rater in rows
    ]


def _cost_usd(input_tokens: int, output_tokens: int, reasoning_tokens: int) -> float:
    settings = get_settings()
    return (
        input_tokens / 1_000_000 * settings.llm_input_price_per_million_usd
        # Gemini's own pricing page bills thinking/reasoning tokens at the
        # output rate ("Output price (including thinking tokens)"), so the
        # gap between total_token_count and input+output+cached -- which
        # gemini-3.6-flash always has, since it's a thinking model and this
        # SDK version has no dedicated thoughts_token_count field -- gets
        # costed the same way rather than silently dropped.
        + (output_tokens + reasoning_tokens) / 1_000_000 * settings.llm_output_price_per_million_usd
    )


def _row(input_tokens: int, output_tokens: int, cached_tokens: int, reasoning_tokens: int, calls: int) -> dict:
    settings = get_settings()
    cost_usd = _cost_usd(input_tokens, output_tokens, reasoning_tokens)
    return {
        "calls": calls,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cached_tokens": cached_tokens,
        "reasoning_tokens": reasoning_tokens,
        "total_tokens": input_tokens + output_tokens + cached_tokens + reasoning_tokens,
        "cost_usd": round(cost_usd, 6),
        "cost_krw": round(cost_usd * settings.krw_per_usd, 2),
    }


@router.get("/usage")
def token_usage(user: User = Depends(require_role("admin")), db: Session = Depends(get_db)):
    """
    Real per-node, per-day token usage and estimated USD/KRW cost, computed
    from the token_usage run_events every LLM call already writes (see
    core/tracing.py's _log_token_usage) -- this was previously only
    answerable by querying Postgres directly. Estimated: pricing is
    last-checked-manually (see core/config.py), and reasoning_tokens is a
    derived gap (total_token_count minus input/output/cached), not a value
    Gemini reports directly under this SDK version.
    """
    events = db.query(RunEvent).filter(RunEvent.event_type == "token_usage").all()

    by_node: dict[str, dict[str, int]] = defaultdict(lambda: {"input": 0, "output": 0, "cached": 0, "total": 0, "calls": 0})
    by_day: dict[str, dict[str, int]] = defaultdict(lambda: {"input": 0, "output": 0, "cached": 0, "total": 0, "calls": 0})
    totals = {"input": 0, "output": 0, "cached": 0, "total": 0, "calls": 0}

    for e in events:
        payload = e.payload or {}
        node = payload.get("node") or "unknown"
        day = e.created_at.date().isoformat() if e.created_at else "unknown"
        input_tokens = payload.get("input_tokens", 0) or 0
        output_tokens = payload.get("output_tokens", 0) or 0
        cached_tokens = payload.get("cached_tokens", 0) or 0
        total_tokens = payload.get("total_tokens", 0) or 0
        calls = payload.get("calls", 1) or 1

        for bucket in (by_node[node], by_day[day], totals):
            bucket["input"] += input_tokens
            bucket["output"] += output_tokens
            bucket["cached"] += cached_tokens
            bucket["total"] += total_tokens
            bucket["calls"] += calls

    def _to_row(v: dict) -> dict:
        reasoning = max(0, v["total"] - v["input"] - v["output"] - v["cached"])
        return _row(v["input"], v["output"], v["cached"], reasoning, v["calls"])

    settings = get_settings()
    return {
        "model": settings.llm_model,
        "pricing_usd_per_million": {
            "input": settings.llm_input_price_per_million_usd,
            "output": settings.llm_output_price_per_million_usd,
        },
        "krw_per_usd": settings.krw_per_usd,
        "totals": _to_row(totals),
        "by_node": [
            {"node": node, **_to_row(v)}
            for node, v in sorted(by_node.items(), key=lambda kv: -kv[1]["input"] - kv[1]["output"])
        ],
        "by_day": [
            {"day": day, **_to_row(v)}
            for day, v in sorted(by_day.items())
        ],
    }
