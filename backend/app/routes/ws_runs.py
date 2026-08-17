"""
WebSocket channel for live run progress: node start/finish, the audit
trail as it's written, and LLM tokens as they're generated -- all pushed
to the client while a run/resume is in flight, instead of the client
waiting silently for the single REST response.

One long-lived connection per browser tab. The client sends one action at
a time ({"action": "start"|"message"|"approval", ...}); the server streams
zero or more progress events for that action, then exactly one terminal
{"type": "result", ...} or {"type": "error", ...} message, mirroring the
same run_id/status/card shape the REST endpoints in routes/runs.py return
-- so a client that only cares about the final state can treat this like
REST-over-a-socket and ignore everything but "result".

The REST endpoints in routes/runs.py are untouched and still work exactly
as before; this is purely additive.
"""
from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from starlette.concurrency import run_in_threadpool

from app.core import events
from app.core.deps import can_decide
from app.core.security import SESSION_COOKIE_NAME, decode_session_token
from app.db.models import Run, User
from app.db.session import SessionLocal
from app.orchestrator import graph

router = APIRouter()
logger = logging.getLogger(__name__)


class _EventPump:
    """Bridges events.emit() calls made on a worker thread (inside a node
    or an LLM call) back onto this connection's asyncio event loop, so they
    can be sent over the WebSocket as they happen."""

    def __init__(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop
        self.queue: asyncio.Queue = asyncio.Queue()

    def sink(self, event: dict) -> None:
        try:
            asyncio.run_coroutine_threadsafe(self.queue.put(event), self._loop)
        except RuntimeError:
            # Event loop already closed (client disconnected mid-run) --
            # the run itself must still complete and commit; just drop the
            # now-unwatchable progress event instead of raising into the
            # node/LLM call that's trying to emit it.
            pass


async def _pump_events(ws: WebSocket, pump: _EventPump, stop: asyncio.Event) -> None:
    while True:
        get_task = asyncio.create_task(pump.queue.get())
        stop_task = asyncio.create_task(stop.wait())
        done, pending = await asyncio.wait({get_task, stop_task}, return_when=asyncio.FIRST_COMPLETED)
        for task in pending:
            task.cancel()
        if get_task in done:
            await ws.send_json(get_task.result())
        if stop_task in done and pump.queue.empty():
            break


async def _run_watched(ws: WebSocket, run_id: str, fn, *args):
    """Registers a live sink for a known run_id, runs the blocking graph
    call off the event loop, streams every event emitted during it, then
    returns the call's result once streaming has caught up."""
    loop = asyncio.get_running_loop()
    pump = _EventPump(loop)
    stop = asyncio.Event()

    events.register(run_id, pump.sink)
    pump_task = asyncio.create_task(_pump_events(ws, pump, stop))
    try:
        result = await run_in_threadpool(fn, *args)
    finally:
        events.unregister(run_id)
        stop.set()
        await pump_task
    return result


async def _start_watched(ws: WebSocket, db, requester_name: str, message: str, user_id: str):
    """Same as _run_watched, but for start_run specifically: run.id doesn't
    exist until start_run has flushed it, so the sink is registered from
    inside the on_run_created callback (called on the worker thread, the
    instant run.id is known) rather than before the call."""
    loop = asyncio.get_running_loop()
    pump = _EventPump(loop)
    stop = asyncio.Event()
    registered_run_id: dict[str, str] = {}

    def on_run_created(run: Run) -> None:
        registered_run_id["id"] = run.id
        events.register(run.id, pump.sink)

    pump_task = asyncio.create_task(_pump_events(ws, pump, stop))
    try:
        result = await run_in_threadpool(
            graph.start_run, db, requester_name, message, on_run_created, user_id,
        )
    finally:
        if registered_run_id.get("id"):
            events.unregister(registered_run_id["id"])
        stop.set()
        await pump_task
    return result


def _authenticate(ws: WebSocket, db) -> User | None:
    """Same trust source as the REST routes (core.deps.get_current_user):
    the session cookie, decoded with the same secret. FastAPI's Depends()
    injection doesn't run for WebSocket handshakes, so this duplicates the
    decode step rather than reusing the dependency directly."""
    token = ws.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        return None
    payload = decode_session_token(token)
    if payload is None:
        return None
    return db.get(User, payload["sub"])


def _owner_or_admin(run: Run, user: User) -> bool:
    return run.user_id is None or run.user_id == user.id or user.role.value == "admin"


@router.websocket("/ws/runs")
async def runs_ws(ws: WebSocket) -> None:
    await ws.accept()
    auth_db = SessionLocal()
    try:
        user = _authenticate(ws, auth_db)
    finally:
        auth_db.close()
    if user is None:
        await ws.send_json({"type": "error", "detail": "Not authenticated"})
        await ws.close(code=1008)
        return

    try:
        while True:
            body = await ws.receive_json()
            action = body.get("action")
            db = SessionLocal()
            try:
                if action == "start":
                    if user.role.value not in ("requester", "admin"):
                        await ws.send_json({"type": "error", "detail": "Requires role: requester or admin"})
                        continue
                    run, card = await _start_watched(ws, db, user.name, body["message"], user.id)
                    await ws.send_json({"type": "result", "run_id": run.id, "status": run.status, "card": card.model_dump()})

                elif action == "message":
                    run_id = body["run_id"]
                    run = db.get(Run, run_id)
                    if run is None:
                        await ws.send_json({"type": "error", "detail": "Run not found"})
                        continue
                    if not _owner_or_admin(run, user):
                        await ws.send_json({"type": "error", "detail": "Not your request"})
                        continue
                    card = await _run_watched(ws, run_id, graph.handle_message, db, run, body["message"])
                    await ws.send_json({"type": "result", "run_id": run.id, "status": run.status, "card": card.model_dump()})

                elif action == "field_patch":
                    # A requester overwriting or pre-filling one field on
                    # their own in-progress draft (see AgentVisuals.tsx's
                    # editable field chips) -- same ownership rule as
                    # "message" since it's still their draft being edited,
                    # just a structured value instead of free text.
                    run_id = body["run_id"]
                    run = db.get(Run, run_id)
                    if run is None:
                        await ws.send_json({"type": "error", "detail": "Run not found"})
                        continue
                    if not _owner_or_admin(run, user):
                        await ws.send_json({"type": "error", "detail": "Not your request"})
                        continue
                    card = await _run_watched(
                        ws, run_id, graph.handle_field_patch, db, run, body["field"], body["value"],
                    )
                    await ws.send_json({"type": "result", "run_id": run.id, "status": run.status, "card": card.model_dump()})

                elif action == "approval":
                    if user.role.value not in ("approver", "reviewer", "admin"):
                        await ws.send_json({"type": "error", "detail": "Requires role: approver, reviewer, or admin"})
                        continue
                    run_id = body["run_id"]
                    run = db.get(Run, run_id)
                    if run is None:
                        await ws.send_json({"type": "error", "detail": "Run not found"})
                        continue
                    if not can_decide(run, user):
                        await ws.send_json({"type": "error", "detail": "This request wasn't routed to you"})
                        continue
                    card = await _run_watched(
                        ws, run_id, graph.handle_approval_response, db, run, body["approved"], body.get("reason"),
                        user.name,
                    )
                    await ws.send_json({"type": "result", "run_id": run.id, "status": run.status, "card": card.model_dump()})

                else:
                    await ws.send_json({"type": "error", "detail": f"Unknown action {action!r}"})
            except Exception as exc:
                logger.exception("ws_runs action failed")
                await ws.send_json({"type": "error", "detail": str(exc)})
            finally:
                db.close()
    except WebSocketDisconnect:
        pass
