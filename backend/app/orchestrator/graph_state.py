"""
Graph state. The five fields in the Sprint 1 spec (run_id, draft, messages,
retrieval_attempts, retrieved_policies, status) are the ones that carry
meaning across the whole run. The rest are routing plumbing needed to make
LangGraph's interrupt/resume replay semantics safe (see nodes.py's module
docstring) — they don't represent anything a client would ever care about.
"""
from __future__ import annotations

from typing import TypedDict


class OrchestratorState(TypedDict, total=False):
    run_id: str
    requester_name: str
    draft: dict
    messages: list[dict]  # [{"role": "user", "content": str}, ...]
    retrieval_attempts: int
    retrieved_policies: list[dict]  # [{title, doc_id, score, text}, ...]
    # [{rule, status: "passed"|"binding"|"outstanding", evidence}, ...] --
    # set by draft_node from the same structured_call that already reads
    # the retrieved excerpts, not a separate LLM call.
    policy_evaluation: list[dict]
    status: str  # mirrors RunStatus.value

    # Routing/plumbing only — not part of the spec's five state fields.
    policy_relevance: str | None  # "relevant" | "not_relevant", set by policy_research
    next_query: str | None  # refined query suggested by the relevance check
    pending_question: str | None  # set by intake when not ready_to_draft
    manager_target: str  # set by manager, read by the conditional edge after it
    approval_decision: dict  # {"approved": bool, "reason": str | None}, set on resume
