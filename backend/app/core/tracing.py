"""
OpenTelemetry setup — operational tracing only (latency, request/graph/node
timing), console exporter, no real backend stood up.

This is deliberately separate from two other tracing-shaped things already
in this codebase, which answer different questions:
- run_events (db/models.py) is the client-facing audit trail — "what
  happened to this request."
- LangSmith (services/llm.py, services/embedding.py) is AI-decision
  tracing — "why did the model decide what it decided, with what prompt."
This module only answers "where did the time go" — plain request/graph/node
latency, the question an ops dashboard would care about. None of the three
replaces either of the others.
"""
from __future__ import annotations

import functools
from typing import Callable

from langgraph.errors import GraphInterrupt
from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import ConsoleSpanExporter, SimpleSpanProcessor
from opentelemetry.trace import Status, StatusCode

_provider = TracerProvider(resource=Resource.create({"service.name": "agent-platform-backend"}))
# SimpleSpanProcessor exports each span synchronously as it ends, so it
# shows up in the console immediately -- right for "prove this works right
# now," not for production throughput (BatchSpanProcessor would be the
# production choice once/if a real backend gets stood up).
_provider.add_span_processor(SimpleSpanProcessor(ConsoleSpanExporter()))
trace.set_tracer_provider(_provider)

tracer = trace.get_tracer("agent-platform")


def instrument_app(app) -> None:
    """Auto-instruments FastAPI: one span per HTTP request."""
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

    FastAPIInstrumentor.instrument_app(app)


def traced_node(name: str) -> Callable:
    """Wraps a LangGraph node function in its own span. Spans nest
    automatically via OTel's context propagation: as long as this runs
    while the graph.invoke() span (see graph.py) is still current on the
    same thread -- true for LangGraph's synchronous .invoke() -- each node
    span comes out as a child of it, and graph.invoke as a child of the
    FastAPI request span."""

    def decorator(fn: Callable) -> Callable:
        @functools.wraps(fn)
        def wrapper(state, config):
            # record_exception/set_status_on_exception=False: the default
            # auto-handling would run *after* our except block below and
            # clobber the OK status we set for GraphInterrupt back to ERROR.
            # We take over exception recording entirely instead, so real
            # errors still get recorded properly and GraphInterrupt doesn't.
            with tracer.start_as_current_span(
                f"node.{name}", record_exception=False, set_status_on_exception=False,
            ) as span:
                span.set_attribute("graph.node", name)
                span.set_attribute("run.id", state.get("run_id", ""))
                try:
                    result = fn(state, config)
                except GraphInterrupt:
                    # LangGraph's normal pause-for-human-input mechanism,
                    # implemented as a raised exception -- not a real
                    # failure. Must still propagate (LangGraph's own
                    # machinery catches it), just not as an error span.
                    span.set_status(Status(StatusCode.OK))
                    raise
                except Exception as exc:
                    span.record_exception(exc)
                    span.set_status(Status(StatusCode.ERROR, str(exc)))
                    raise
                else:
                    span.set_status(Status(StatusCode.OK))
                    return result

        return wrapper

    return decorator
