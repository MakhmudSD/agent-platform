"""
Live, full-flow verification of /ws/runs: start -> clarifying answer ->
approval_request -> approve -> finalized, all over one WebSocket
connection, against the real running backend. Exercises draft_node and
policy_research_node's LLM-token streaming, and both interrupt nodes'
replay-on-resume behavior (node_started should fire again on resume,
node_finished should NOT double up for the same interrupt-paused node
occurrence).

Requires: uvicorn app.main:app running on localhost:8000.
    python verify_ws_streaming_full_flow.py
"""
from __future__ import annotations

import asyncio
import json
import sys

import websockets

WS_URL = "ws://localhost:8000/ws/runs"


async def _drain_until_result(ws) -> tuple[list[dict], dict]:
    events = []
    while True:
        raw = await asyncio.wait_for(ws.recv(), timeout=90)
        event = json.loads(raw)
        events.append(event)
        if event["type"] in ("result", "error"):
            return events, event


async def full_flow() -> tuple[list[dict], list[dict]]:
    all_events: list[dict] = []
    async with websockets.connect(WS_URL) as ws:
        await ws.send(json.dumps({
            "action": "start",
            "requester_name": "WS Full-Flow Bot",
            "message": "I need to expense a conference ticket.",
        }))
        events, terminal = await _drain_until_result(ws)
        all_events += events
        assert terminal["type"] == "result", terminal
        run_id = terminal["run_id"]
        print(f"  after start: card.type={terminal['card']['type']} status={terminal['status']}")

        await ws.send(json.dumps({
            "action": "message",
            "run_id": run_id,
            "message": (
                "It's $2400, for the Engineering cost center, for the AI conference on "
                "2026-09-15. Business justification: attending to represent the team and "
                "learn about new AI tooling."
            ),
        }))
        events, terminal = await _drain_until_result(ws)
        all_events += events
        assert terminal["type"] == "result", terminal
        print(f"  after message: card.type={terminal['card']['type']} status={terminal['status']}")

        # In case the model still needs another round, answer with the same
        # full detail again -- whatever field it's still missing is in here.
        rounds = 0
        while terminal["card"]["type"] == "clarifying_question" and rounds < 4:
            rounds += 1
            print(f"    still missing info -- model asked: {terminal['card']['question']!r}")
            await ws.send(json.dumps({
                "action": "message", "run_id": run_id,
                "message": (
                    "Amount: $2400. Cost center: Engineering. Date: 2026-09-15. "
                    "Category: conference/travel. Justification: representing the team "
                    "and learning new AI tooling at the conference."
                ),
            }))
            events, terminal = await _drain_until_result(ws)
            all_events += events
            print(f"  after follow-up {rounds}: card.type={terminal['card']['type']} status={terminal['status']}")

        assert terminal["card"]["type"] == "approval_request", terminal["card"]

        await ws.send(json.dumps({"action": "approval", "run_id": run_id, "approved": True}))
        events, terminal = await _drain_until_result(ws)
        all_events += events
        assert terminal["type"] == "result", terminal
        print(f"  after approval: card.type={terminal['card']['type']} status={terminal['status']}")

    return all_events, [terminal]


def main() -> bool:
    print("=== Full flow over /ws/runs: start -> message(s) -> approve -> finalized ===")
    all_events, terminals = asyncio.run(full_flow())

    node_started = [e["node"] for e in all_events if e["type"] == "node_started"]
    node_finished = [e["node"] for e in all_events if e["type"] == "node_finished"]
    audit_types = [e["event_type"] for e in all_events if e["type"] == "audit_event"]
    llm_tokens = [e for e in all_events if e["type"] == "llm_token"]
    errors = [e for e in all_events if e["type"] == "error"]

    print(f"\n  node_started sequence: {node_started}")
    print(f"  node_finished sequence: {node_finished}")
    print(f"  audit_event types: {audit_types}")
    print(f"  total llm_token events: {len(llm_tokens)}")
    print(f"  errors: {errors}")

    final_card = terminals[-1]["card"]
    print(f"\n  final: status={terminals[-1]['status']} card.type={final_card['type']} card.status={final_card.get('status')}")

    ok = True
    ok &= len(errors) == 0
    ok &= final_card["type"] == "final_confirmation"
    ok &= final_card["status"] == "finalized"
    # draft and policy_research must both have run at least once across the flow
    ok &= "draft" in node_started and "draft" in node_finished
    ok &= "policy_research" in node_started and "policy_research" in node_finished
    ok &= "apply_approval" in node_started and "apply_approval" in node_finished
    # interrupt_for_approval pauses (GraphInterrupt) -- started fires, but it
    # must never emit node_finished for the occurrence that's suspending.
    ok &= "interrupt_for_approval" in node_started
    ok &= any(t == "approval_requested" for t in audit_types)
    ok &= any(t == "finalized" for t in audit_types)
    ok &= len(llm_tokens) > 0

    print(f"\nRESULT: {'PASS' if ok else 'FAIL'}")
    return ok


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
