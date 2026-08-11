"""
Live verification of the /ws/runs event plumbing -- against the real
running backend (real Postgres, real Gemini calls), not mocks. This is the
one test that actually proves the thread -> event-loop -> WebSocket hop
works: node_started/node_finished, audit_event, and llm_token all have to
arrive at a real client for this to mean anything.

Requires: uvicorn app.main:app running on localhost:8000.
Run with the backend venv active:
    python verify_ws_streaming.py
"""
from __future__ import annotations

import asyncio
import json
import sys

import websockets

WS_URL = "ws://localhost:8000/ws/runs"


async def run_start_and_collect() -> list[dict]:
    events: list[dict] = []
    async with websockets.connect(WS_URL) as ws:
        await ws.send(json.dumps({
            "action": "start",
            "requester_name": "WS Verification Bot",
            "message": "I need to expense a conference ticket, about $2400, for the Engineering team.",
        }))
        while True:
            raw = await asyncio.wait_for(ws.recv(), timeout=90)
            event = json.loads(raw)
            events.append(event)
            if event["type"] in ("result", "error"):
                break
    return events


def main() -> bool:
    print("=== Connecting to /ws/runs and starting a real run ===")
    events = asyncio.run(run_start_and_collect())

    types_seen = [e["type"] for e in events]
    print(f"\n  total messages received: {len(events)}")
    print(f"  event type sequence: {types_seen}")

    node_started = [e for e in events if e["type"] == "node_started"]
    node_finished = [e for e in events if e["type"] == "node_finished"]
    audit_events = [e for e in events if e["type"] == "audit_event"]
    llm_tokens = [e for e in events if e["type"] == "llm_token"]
    results = [e for e in events if e["type"] == "result"]
    errors = [e for e in events if e["type"] == "error"]

    print(f"\n  node_started events: {[e['node'] for e in node_started]}")
    print(f"  node_finished events: {[e['node'] for e in node_finished]}")
    print(f"  audit_event types: {[e['event_type'] for e in audit_events]}")
    print(f"  llm_token count: {len(llm_tokens)} (sample: {[e['text'] for e in llm_tokens[:3]]})")
    print(f"  errors: {errors}")

    if results:
        result = results[0]
        print(f"\n  final result: run_id={result['run_id']} status={result['status']} card.type={result['card']['type']}")

    ok = True
    ok &= len(errors) == 0
    ok &= len(results) == 1
    ok &= "manager" in [e["node"] for e in node_started]
    ok &= "manager" in [e["node"] for e in node_finished]
    ok &= any(e["event_type"] == "manager_decision" for e in audit_events)
    ok &= len(llm_tokens) > 0
    # Every llm_token's concatenated text, per node, should be non-garbage --
    # spot check by joining tokens for one node and confirming it isn't empty.
    ok &= all(len(e["text"]) > 0 for e in llm_tokens)

    print(f"\nRESULT: {'PASS' if ok else 'FAIL'}")
    return ok


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
