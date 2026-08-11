"""
In-process live-event fan-out for a run currently being watched over a
WebSocket. Deliberately not a message queue or pub/sub service -- this is a
single-process MVP, and a run is only ever watched by the one connection
that started/resumed it.

A run's graph execution (graph.invoke()) runs on a worker thread handed off
by FastAPI's run_in_threadpool; the WebSocket that wants to observe it lives
on the asyncio event loop in a different thread. `register()` is called
from the event-loop side with a sink that already knows how to hop back
onto the loop (asyncio.run_coroutine_threadsafe); `emit()` is called from
inside node/LLM code running on the worker thread and looks the sink up by
run_id. If nothing is watching a run (plain REST call, no WS), `emit()` is
a harmless no-op -- this module adds zero behavior change for callers that
never register.

`current_run_id()`/`current_node()` piggyback a thread-local so LLM code
deep inside a node (services/llm.py) can tag its token events with which
run and node they belong to, without threading run_id through every call
signature. Safe because a run's nodes execute sequentially on one worker
thread, never concurrently with another run's nodes on the same thread.
"""
from __future__ import annotations

import threading
from typing import Callable

_lock = threading.Lock()
_sinks: dict[str, Callable[[dict], None]] = {}
_current = threading.local()


def register(run_id: str, sink: Callable[[dict], None]) -> None:
    with _lock:
        _sinks[run_id] = sink


def unregister(run_id: str) -> None:
    with _lock:
        _sinks.pop(run_id, None)


def emit(run_id: str | None, event: dict) -> None:
    if not run_id:
        return
    with _lock:
        sink = _sinks.get(run_id)
    if sink is not None:
        sink(event)


def set_current(run_id: str | None, node: str | None) -> None:
    _current.run_id = run_id
    _current.node = node


def clear_current() -> None:
    _current.run_id = None
    _current.node = None


def current_run_id() -> str | None:
    return getattr(_current, "run_id", None)


def current_node() -> str | None:
    return getattr(_current, "node", None)
