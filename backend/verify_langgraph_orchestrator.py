"""
Standalone verification script for the LangGraph orchestrator rebuild.
Mocks structured_call and retrieve_policy (the only two functions that talk
to Gemini / do real retrieval); everything else — the graph, the Postgres
checkpointer, the runs/run_events tables — is exercised for real against
the local database.

Run with the backend venv active:
    python verify_langgraph_orchestrator.py
"""
from __future__ import annotations

import json
import sys
from unittest.mock import patch

from app.db.models import Notification, Run, RunEvent
from app.db.session import SessionLocal
from app.orchestrator import graph as graph_module
from app.orchestrator.nodes import MANAGER_SYSTEM_PROMPT, RELEVANCE_SYSTEM_PROMPT
from app.orchestrator.vertical_employee_request import (
    DRAFT_SYSTEM_PROMPT, GATHER_SYSTEM_PROMPT,
    ESCALATION_SYSTEM_PROMPT, APPROVAL_SUMMARY_SYSTEM_PROMPT,
)
from app.services.retrieval import PolicyMatch

FAKE_MATCHES = [
    PolicyMatch(
        doc_id="11111111-1111-1111-1111-111111111111",
        title="Travel & Conference Expense Policy",
        text="Conference registration fees up to $3,000 are permitted without director approval.",
        score=0.9,
    ),
    PolicyMatch(
        doc_id="22222222-2222-2222-2222-222222222222",
        title="Cost Center Guidelines",
        text="All requests must be tagged to an active cost center.",
        score=0.5,
    ),
]

COMPLETE_DRAFT = {
    "category": "Conference",
    "amount": 2400,
    "date": "2026-08-12",
    "justification": "Attending an industry conference relevant to my role.",
    "cost_center": "Engineering",
}


def cooperative_manager_decide(context: dict) -> dict:
    """Mimics the real manager prompt's intended logic faithfully."""
    if context["status"] in ("finalized", "rejected"):
        return {"next": "done", "reasoning": "run is already terminal"}
    if not context["draft_complete"]:
        return {"next": "intake", "reasoning": "draft is missing required fields"}
    if context["status"] == "awaiting_approval":
        return {"next": "interrupt_for_approval", "reasoning": "final draft is ready for a human decision"}
    relevance = context["policy_relevance"]
    attempts = context["retrieval_attempts"]
    if relevance is None:
        return {"next": "policy_research", "reasoning": "no policy retrieved yet"}
    if relevance == "not_relevant" and attempts < 2:
        return {"next": "policy_research", "reasoning": f"last retrieval was not relevant, retrying (attempt {attempts})"}
    return {"next": "draft", "reasoning": "retrieved policy is relevant enough (or attempts exhausted)"}


def stubborn_manager_decide(context: dict) -> dict:
    """Never voluntarily gives up on retrieval — used to prove the retry cap
    is enforced in code, not just because a cooperative mock stopped asking."""
    if not context["draft_complete"]:
        return {"next": "intake", "reasoning": "draft is missing required fields"}
    if context["status"] == "awaiting_approval":
        return {"next": "interrupt_for_approval", "reasoning": "final draft is ready for a human decision"}
    return {"next": "policy_research", "reasoning": "always worth one more try (deliberately stubborn mock)"}


def build_structured_call_mock(manager_decide, relevance_sequence, gather_sequence):
    relevance_iter = iter(relevance_sequence)
    gather_iter = iter(gather_sequence)

    def _mock(system_prompt: str, user_content: str) -> dict:
        if system_prompt == MANAGER_SYSTEM_PROMPT:
            return manager_decide(json.loads(user_content))
        if system_prompt == GATHER_SYSTEM_PROMPT:
            return next(gather_iter)
        if system_prompt == RELEVANCE_SYSTEM_PROMPT:
            relevant = next(relevance_iter)
            return {"relevant": relevant, "refined_query": "" if relevant else "refined query, try again"}
        if system_prompt == DRAFT_SYSTEM_PROMPT:
            return {"final_draft": dict(COMPLETE_DRAFT), "policy_notes": "Travel & Conference Expense Policy applies.",
                    "policy_evaluation": []}
        if system_prompt == ESCALATION_SYSTEM_PROMPT:
            return {"routed_to": "approver", "reviewer_category": None,
                    "reason": "Within standard conference spend threshold.",
                    "confidence": "high", "triggered_rule": None}
        if system_prompt == APPROVAL_SUMMARY_SYSTEM_PROMPT:
            return {"summary": "Requesting $2,400 for an industry conference; clears policy cleanly."}
        raise AssertionError(f"Unexpected system_prompt (first 60 chars): {system_prompt[:60]!r}")

    return _mock


def event_types_for(db, run_id: str) -> list[str]:
    events = (
        db.query(RunEvent)
        .filter_by(run_id=run_id)
        .order_by(RunEvent.created_at, RunEvent.id)
        .all()
    )
    return [e.event_type for e in events], events


def cleanup(db, run_id: str) -> None:
    db.query(RunEvent).filter_by(run_id=run_id).delete()
    db.query(Run).filter_by(id=run_id).delete()
    db.commit()
    with graph_module._checkpointer_pool.connection() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM checkpoints WHERE thread_id = %s", (run_id,))
        cur.execute("DELETE FROM checkpoint_writes WHERE thread_id = %s", (run_id,))
        cur.execute("DELETE FROM checkpoint_blobs WHERE thread_id = %s", (run_id,))


# ---------------------------------------------------------------------------
# Test 1: full happy path, same event sequence as before + manager_decision
# ---------------------------------------------------------------------------

def test_happy_path() -> bool:
    print("\n=== TEST 1: full happy path (gathering -> approval -> finalized) ===")
    db = SessionLocal()
    ok = True
    try:
        gather_sequence = [
            {"updated_draft": {**COMPLETE_DRAFT, "cost_center": ""}, "ready_to_draft": False,
             "next_question": "What is the cost center for this expense?"},
            {"updated_draft": COMPLETE_DRAFT, "ready_to_draft": True},
        ]
        mock_fn = build_structured_call_mock(cooperative_manager_decide, relevance_sequence=[True], gather_sequence=gather_sequence)

        with patch("app.orchestrator.nodes.structured_call", side_effect=mock_fn), \
             patch("app.orchestrator.nodes.retrieve_policy", return_value=FAKE_MATCHES):

            run, card1 = graph_module.start_run(db, "Verification Bot", "I need to expense a conference ticket, about $2400")
            print(f"  start_run -> card.type = {card1.type!r}")
            ok &= card1.type == "clarifying_question"

            card2 = graph_module.handle_message(db, run, "Cost center is Engineering")
            print(f"  handle_message -> card.type = {card2.type!r}, citations = {len(card2.policy_citations)}")
            ok &= card2.type == "approval_request"
            ok &= len(card2.policy_citations) >= 1
            ok &= bool(card2.policy_citations[0].excerpt.strip()) if card2.policy_citations else False

            card3 = graph_module.handle_approval_response(db, run, approved=True, reason=None)
            print(f"  handle_approval_response -> card.type = {card3.type!r}, status = {card3.status!r}")
            ok &= card3.type == "final_confirmation" and card3.status == "finalized"

        event_types, events = event_types_for(db, run.id)
        print("  event sequence logged:")
        for t in event_types:
            print(f"    - {t}")

        non_manager_events = [t for t in event_types if t != "manager_decision"]
        # "user_message" is a restored event, not a new one -- engine.py logged
        # it via handle_message() and the first version of this rebuild
        # dropped it (await_message_node had no side effects at all). Fixed
        # after code review; expected_baseline reflects the fix.
        expected_baseline = [
            "run_started", "draft_updated", "clarifying_question_asked",
            "user_message", "draft_updated", "state_transition", "policy_retrieved",
            "state_transition", "draft_finalized_for_review", "policy_evaluated",
            "routing_decided", "approval_summary_generated", "state_transition",
            "approval_requested", "approved", "finalized",
        ]
        print(f"  non-manager_decision subsequence matches pre-rebuild baseline (+ restored user_message): {non_manager_events == expected_baseline}")
        ok &= non_manager_events == expected_baseline

        manager_decisions = [e for e in events if e.event_type == "manager_decision"]
        print(f"  manager_decision events logged: {len(manager_decisions)}")
        # 3, not 4: the manager is no longer consulted once the draft is
        # complete and policy is relevant -- draft -> escalation_routing ->
        # approval_summary -> interrupt_for_approval is now a fixed pipeline,
        # so the old 4th "decide to interrupt_for_approval" call never happens.
        ok &= len(manager_decisions) == 3
        ok &= all(md.payload.get("reasoning") for md in manager_decisions)

        cleanup(db, run.id)
    finally:
        db.close()

    print(f"  RESULT: {'PASS' if ok else 'FAIL'}")
    return ok


# ---------------------------------------------------------------------------
# Test 2: loopback — not relevant then relevant
# ---------------------------------------------------------------------------

def test_loopback() -> bool:
    print("\n=== TEST 2: manager loopback (not_relevant -> retry -> relevant) ===")
    db = SessionLocal()
    ok = True
    try:
        gather_sequence = [{"updated_draft": COMPLETE_DRAFT, "ready_to_draft": True}]
        mock_fn = build_structured_call_mock(cooperative_manager_decide, relevance_sequence=[False, True], gather_sequence=gather_sequence)

        with patch("app.orchestrator.nodes.structured_call", side_effect=mock_fn), \
             patch("app.orchestrator.nodes.retrieve_policy", return_value=FAKE_MATCHES):
            run, card = graph_module.start_run(
                db, "Verification Bot", "Conference ticket, $2400, Engineering cost center, today",
            )

        print(f"  final card.type after single start_run() call: {card.type!r}")
        ok &= card.type == "approval_request"

        event_types, events = event_types_for(db, run.id)
        print("  event sequence logged:")
        for t in event_types:
            print(f"    - {t}")

        policy_retrieved_count = event_types.count("policy_retrieved")
        print(f"  policy_retrieved count (should be 2): {policy_retrieved_count}")
        ok &= policy_retrieved_count == 2

        manager_events = [e for e in events if e.event_type == "manager_decision"]
        retry_events = [e for e in manager_events if "policy_research" in e.payload.get("next", "") and "retrying" in e.payload.get("reasoning", "")]
        print(f"  manager_decision events explaining the reroute: {len(retry_events)}")
        for e in retry_events:
            print(f"    -> next={e.payload['next']!r} reasoning={e.payload['reasoning']!r}")
        ok &= len(retry_events) == 1

        state = graph_module._graph.get_state({"configurable": {"thread_id": run.id}})
        final_attempts = state.values.get("retrieval_attempts")
        print(f"  final retrieval_attempts in graph state: {final_attempts}")
        ok &= final_attempts == 2

        cleanup(db, run.id)
    finally:
        db.close()

    print(f"  RESULT: {'PASS' if ok else 'FAIL'}")
    return ok


# ---------------------------------------------------------------------------
# Test 3: retry cap — always not relevant, must still proceed after 2 tries
# ---------------------------------------------------------------------------

def test_retry_cap() -> bool:
    print("\n=== TEST 3: retry cap (always not_relevant, stubborn manager mock) ===")
    db = SessionLocal()
    ok = True
    try:
        gather_sequence = [{"updated_draft": COMPLETE_DRAFT, "ready_to_draft": True}]
        # relevance always False, and the manager mock NEVER voluntarily proceeds
        # to draft on its own -- if this test passes, it's the code-level hard
        # cap in manager_node (not LLM cooperation) that stopped the loop.
        mock_fn = build_structured_call_mock(stubborn_manager_decide, relevance_sequence=[False, False], gather_sequence=gather_sequence)

        with patch("app.orchestrator.nodes.structured_call", side_effect=mock_fn), \
             patch("app.orchestrator.nodes.retrieve_policy", return_value=FAKE_MATCHES):
            run, card = graph_module.start_run(
                db, "Verification Bot", "Conference ticket, $2400, Engineering cost center, today",
            )

        print(f"  final card.type: {card.type!r}")
        ok &= card.type == "approval_request"

        event_types, events = event_types_for(db, run.id)
        print("  event sequence logged:")
        for t in event_types:
            print(f"    - {t}")

        policy_retrieved_count = event_types.count("policy_retrieved")
        print(f"  policy_retrieved count (should be exactly 2, not more): {policy_retrieved_count}")
        ok &= policy_retrieved_count == 2

        manager_events = [e for e in events if e.event_type == "manager_decision"]
        override_events = [e for e in manager_events if "overridden by hard cap" in e.payload.get("reasoning", "")]
        print(f"  manager_decision events showing the hard-cap override fired: {len(override_events)}")
        for e in override_events:
            print(f"    -> next={e.payload['next']!r} reasoning={e.payload['reasoning']!r}")
        ok &= len(override_events) == 1

        state = graph_module._graph.get_state({"configurable": {"thread_id": run.id}})
        final_attempts = state.values.get("retrieval_attempts")
        print(f"  final retrieval_attempts in graph state (should be capped at 2): {final_attempts}")
        ok &= final_attempts == 2

        cleanup(db, run.id)
    finally:
        db.close()

    print(f"  RESULT: {'PASS' if ok else 'FAIL'}")
    return ok


# ---------------------------------------------------------------------------
# Test 4: reject path — reason must survive into the returned card, not just
# the audit trail. Regression test: this broke once already (graph.py
# hardcoded reason=None in _card_from_final_state) and none of tests 1-3
# would have caught it, since they only ever approve.
# ---------------------------------------------------------------------------

def test_reject_path() -> bool:
    print("\n=== TEST 4: reject path (reason must reach the returned card) ===")
    db = SessionLocal()
    ok = True
    try:
        gather_sequence = [{"updated_draft": COMPLETE_DRAFT, "ready_to_draft": True}]
        mock_fn = build_structured_call_mock(cooperative_manager_decide, relevance_sequence=[True], gather_sequence=gather_sequence)

        with patch("app.orchestrator.nodes.structured_call", side_effect=mock_fn), \
             patch("app.orchestrator.nodes.retrieve_policy", return_value=FAKE_MATCHES):
            run, card1 = graph_module.start_run(
                db, "Verification Bot", "Conference ticket, $2400, Engineering cost center, today",
            )
            ok &= card1.type == "approval_request"

            card2 = graph_module.handle_approval_response(db, run, approved=False, reason="Needs revision")
            print(f"  handle_approval_response(approved=False) -> card.type={card2.type!r} status={card2.status!r} reason={card2.reason!r}")
            ok &= card2.type == "final_confirmation"
            ok &= card2.status == "rejected"
            ok &= card2.reason == "Needs revision"

        event_types, events = event_types_for(db, run.id)
        ok &= "rejected" in event_types
        ok &= "finalized" not in event_types
        print(f"  'rejected' event logged, no 'finalized' event: {ok}")

        notifications = db.query(Notification).filter_by(run_id=run.id).all()
        notif_messages = [n.message for n in notifications]
        print(f"  notifications for this run: {notif_messages}")
        rejected_notif = [m for m in notif_messages if "was rejected" in m]
        ok &= len(rejected_notif) == 1
        ok &= not any("was approved" in m for m in notif_messages)
        print(f"  exactly one 'was rejected' notification, no 'was approved' notification: {ok}")

        cleanup(db, run.id)
    finally:
        db.close()

    print(f"  RESULT: {'PASS' if ok else 'FAIL'}")
    return ok


if __name__ == "__main__":
    results = {
        "test_happy_path": test_happy_path(),
        "test_loopback": test_loopback(),
        "test_retry_cap": test_retry_cap(),
        "test_reject_path": test_reject_path(),
    }
    print("\n=== SUMMARY ===")
    for name, passed in results.items():
        print(f"  {name}: {'PASS' if passed else 'FAIL'}")
    graph_module._checkpointer_pool.close()
    sys.exit(0 if all(results.values()) else 1)
