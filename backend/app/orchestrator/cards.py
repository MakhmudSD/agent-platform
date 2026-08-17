"""
The structured "card" protocol. The orchestrator never sends free-form
prose when it needs a specific human response — it emits one of these,
and the frontend renders whichever component matches `type`.

This is deliberately a small, closed set for the MVP. Adding a new card
type is a two-file change (here + one frontend component), not an
architecture change — that's the point of keeping it a discriminated
union instead of a free-text protocol.
"""
from __future__ import annotations

from typing import Literal, Union

from pydantic import BaseModel


class ClarifyingQuestionCard(BaseModel):
    type: Literal["clarifying_question"] = "clarifying_question"
    question: str
    field: str  # which draft field this answer will fill


class PolicyCitationCard(BaseModel):
    type: Literal["policy_citation"] = "policy_citation"
    title: str
    excerpt: str


class PolicyRuleCard(BaseModel):
    rule: str
    status: Literal["passed", "binding", "outstanding"]
    evidence: str


class RoutingDecisionCard(BaseModel):
    routed_to: Literal["approver", "reviewer"]
    reviewer_category: str | None = None
    reason: str
    confidence: Literal["high", "medium", "low"]
    triggered_rule: str | None = None


class ApprovalRequestCard(BaseModel):
    type: Literal["approval_request"] = "approval_request"
    draft: dict
    policy_citations: list[PolicyCitationCard] = []
    policy_evaluation: list[PolicyRuleCard] = []
    routing_decision: RoutingDecisionCard | None = None
    approval_summary: str | None = None


class FinalConfirmationCard(BaseModel):
    type: Literal["final_confirmation"] = "final_confirmation"
    status: Literal["finalized", "rejected"]
    draft: dict
    reason: str | None = None


class TextCard(BaseModel):
    type: Literal["text"] = "text"
    content: str


Card = Union[
    ClarifyingQuestionCard,
    PolicyCitationCard,
    ApprovalRequestCard,
    FinalConfirmationCard,
    TextCard,
]
