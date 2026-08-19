"""
Data model. Three tables:
- runs: one row per workflow instance (an employee's request moving through the flow)
- run_events: append-only audit trail of every state transition — this is what
  gets demoed as "auditable decision trail", not just chat history
- policy_docs: mock reference corpus for retrieval, same shape as Lexara's
  document_chunks (content + embedding), so the retrieval service is a near
  direct port.
"""
import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean, Column, String, Text, DateTime, ForeignKey, Enum as SAEnum, Index
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import declarative_base, relationship
from pgvector.sqlalchemy import Vector

Base = declarative_base()


def _uuid():
    return str(uuid.uuid4())


def _now():
    return datetime.now(timezone.utc)


class RunStatus(str, enum.Enum):
    GATHERING = "gathering"
    RETRIEVING = "retrieving"
    DRAFTING = "drafting"
    AWAITING_APPROVAL = "awaiting_approval"
    FINALIZED = "finalized"
    REJECTED = "rejected"


class UserRole(str, enum.Enum):
    REQUESTER = "requester"
    APPROVER = "approver"
    REVIEWER = "reviewer"
    ADMIN = "admin"


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    email = Column(String(255), nullable=False, unique=True)
    name = Column(String(120), nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(SAEnum(UserRole), nullable=False, default=UserRole.REQUESTER)
    created_at = Column(DateTime(timezone=True), default=_now)


class Run(Base):
    __tablename__ = "runs"

    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    workflow_type = Column(String(64), nullable=False, default="employee_request")
    status = Column(SAEnum(RunStatus), nullable=False, default=RunStatus.GATHERING)

    requester_name = Column(String(120), nullable=False)
    # Nullable and added via a separate ALTER (see data/seed.py) rather than
    # relying on Base.metadata.create_all(), which creates missing tables
    # but never alters existing ones -- this column would silently never
    # appear otherwise. Nullable so pre-auth demo rows (no owning user)
    # keep working; requester_name stays the display source of truth even
    # for rows that do have a user_id.
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    # The evolving structured draft the agent is building up. Kept as JSONB
    # rather than fixed columns so the same run model can host different
    # request schemas (expense, access request, vendor request, ...) without
    # a migration per workflow flavor — this is the "vertical" seam.
    draft = Column(JSONB, nullable=False, default=dict)

    # Set by escalation_routing_node once the draft is finalized: "approver"
    # or "reviewer". Null until then (still gathering/drafting), and for
    # legacy pre-migration rows. Determines both which queue a run shows up
    # in and who is authorized to decide it -- see core/deps.py's
    # require_decider and routes/runs.py's respond_to_approval.
    routed_to = Column(String(20), nullable=True)

    # Requester-only organizing tools, both additive migrations (see
    # seed.py) -- archived hides a run from the owner's own lists without
    # touching run_events (the audit trail stays intact and un-abbreviated,
    # same append-only guarantee as everywhere else); folder_id groups runs
    # the requester chose to file together. Neither affects who can decide
    # a run or what a decider sees -- routed_to/can_decide own that.
    archived = Column(Boolean, nullable=False, default=False)
    folder_id = Column(UUID(as_uuid=False), ForeignKey("folders.id", ondelete="SET NULL"), nullable=True)

    created_at = Column(DateTime(timezone=True), default=_now)
    updated_at = Column(DateTime(timezone=True), default=_now, onupdate=_now)

    events = relationship(
        "RunEvent", back_populates="run", order_by="RunEvent.created_at",
        cascade="all, delete-orphan",
    )


class RunEvent(Base):
    """
    Append-only. Every state transition, tool call, and human action gets a
    row here. Never updated, never deleted — that immutability is the point:
    it's what makes the audit trail trustworthy in the demo.
    """
    __tablename__ = "run_events"

    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    run_id = Column(UUID(as_uuid=False), ForeignKey("runs.id", ondelete="CASCADE"), nullable=False)

    event_type = Column(String(64), nullable=False)
    # e.g. "state_transition", "clarifying_question_asked", "user_answered",
    # "policy_retrieved", "draft_updated", "approval_requested",
    # "approved", "rejected", "finalized"

    payload = Column(JSONB, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), default=_now)

    run = relationship("Run", back_populates="events")

    __table_args__ = (
        Index("ix_run_events_run_id_created_at", "run_id", "created_at"),
    )


class Notification(Base):
    """
    Fired on approval_requested (tells a decider something needs them) and
    on finalized/rejected (tells the Requester their request resolved).

    Two different kinds of "who this is for," both real, not one column
    doing double duty:
    - `user_id`: a single, specific person (the requester, for approved/
      rejected -- there's exactly one owner of a Run).
    - `target_role`: a role, not a person (needs_approval/needs_review --
      the approver/reviewer queue is open, any user holding that role can
      pick it up; there's no single "assigned" approver to point user_id
      at). Set exactly one of the two per row, per `type`.
    Old rows (before this column existed) have both NULL -- the previous
    message-prefix-matching approach couldn't reliably survive two
    requesters sharing a name, which is the real bug this fixes, not just
    an added feature. See seed.py's _migrate_notification_columns for the
    real backfill from existing message text.
    """
    __tablename__ = "notifications"

    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    run_id = Column(UUID(as_uuid=False), ForeignKey("runs.id", ondelete="CASCADE"), nullable=False)
    message = Column(Text, nullable=False)
    read = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), default=_now)
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    target_role = Column(String(20), nullable=True)
    # needs_approval | needs_review | approved | rejected -- nullable only
    # for pre-migration rows that couldn't be confidently backfilled.
    type = Column(String(20), nullable=True)


class Folder(Base):
    """
    A requester's own grouping of their runs -- replaces the old Queue tab's
    role as "a place to organize conversations." Owned by exactly one user;
    no sharing, no decider visibility. Deleting a folder never deletes its
    runs (see routes/folders.py) -- it just un-sets folder_id on them,
    same "organizing metadata is disposable, the run itself never is"
    principle as archived.
    """
    __tablename__ = "folders"

    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(80), nullable=False)
    created_at = Column(DateTime(timezone=True), default=_now)


class RunFeedback(Base):
    """
    Thumbs up/down on a resolved conversation -- one row per (run, user),
    so re-rating overwrites rather than piling up duplicates. Run-level,
    not per-turn: turns are a client-side array with no stable id to hang
    a rating off, and the ask was "get the user experience," which a
    single verdict per conversation already answers.
    """
    __tablename__ = "run_feedback"

    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    run_id = Column(UUID(as_uuid=False), ForeignKey("runs.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    rating = Column(Boolean, nullable=False)  # True = thumbs up, False = thumbs down
    note = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now)
    # Admin's response, if any -- see routes/admin.py's reply_to_feedback.
    # Free-standing text, not another table: one admin reply per feedback
    # row is the whole feature asked for, not a threaded conversation.
    admin_reply = Column(Text, nullable=True)
    admin_reply_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("ix_run_feedback_run_id_user_id", "run_id", "user_id", unique=True),
    )


class PolicyDoc(Base):
    """
    Mock reference corpus. Same shape as Lexara's document_chunks table:
    content + embedding, so retrieval_service.py can be ported with only
    naming changes, not a rewrite.
    """
    __tablename__ = "policy_docs"

    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    title = Column(String(200), nullable=False)
    content = Column(Text, nullable=False)
    embedding = Column(Vector(1536), nullable=True)  # populated at seed time

    created_at = Column(DateTime(timezone=True), default=_now)
