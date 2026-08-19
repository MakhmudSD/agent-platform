"""
Thin LLM wrapper. Structured (JSON-mode) calls only — the orchestrator
never parses free text to decide what to do next, it asks the model for
a typed decision. This is the same "structured outputs over regex parsing"
lesson from Lexara's llm_service.py, applied to agent control flow instead
of chat responses.
"""
from __future__ import annotations

import json
from typing import Callable

import google.generativeai as genai
from google.api_core.exceptions import DeadlineExceeded, ResourceExhausted, ServiceUnavailable
from langsmith import traceable
from langsmith.run_helpers import get_current_run_tree
from tenacity import retry, retry_if_exception_type, stop_after_attempt

from app.core import events
from app.core.config import get_settings
from app.services.retry_wait import wait_for_server_retry_delay

_configured = False


def _ensure_configured() -> None:
    global _configured
    if not _configured:
        genai.configure(api_key=get_settings().gemini_api_key)
        _configured = True


# ResourceExhausted (429, quota), ServiceUnavailable (503, "the model is
# currently experiencing high demand"), and DeadlineExceeded (504, gateway
# timeout) are what google.generativeai actually raises for these --
# confirmed against real tracebacks, not assumed (DeadlineExceeded is the
# one that crashed a live demo-data seeding run: 4 requests through
# cleanly, the 5th's manager call hit a real 504 mid-run and, uncaught,
# took the whole process down with it). All three are transient
# server-side conditions a short wait can clear; retrying on anything else
# (bad request, auth failure) would just burn 3x the time before failing
# the same way, so this stays deliberately narrow to these three.
#
# Wait time comes from the server's own RetryInfo.retryDelay when present
# (Google told us 12s and 53s on the two real 429s we've hit) -- 503s and
# 504s don't carry that detail, so those fall back to a fixed wait in
# wait_for_server_retry_delay rather than a token gesture at backoff that
# fails anyway.
@retry(
    retry=retry_if_exception_type((ResourceExhausted, ServiceUnavailable, DeadlineExceeded)),
    wait=wait_for_server_retry_delay,
    stop=stop_after_attempt(3),
    reraise=True,
)
def _generate_content(
    model: "genai.GenerativeModel",
    user_content: str,
    generation_config: "genai.GenerationConfig",
    on_token: Callable[[str], None] | None = None,
):
    if on_token is None:
        return model.generate_content(user_content, generation_config=generation_config)

    # Streamed path: consumed *inside* this function, not by the caller, so
    # a 429 raised mid-stream still surfaces inside the @retry frame above
    # instead of escaping it -- a generator handed back unconsumed would
    # silently stop retrying rate limits the moment a caller iterates it.
    response = model.generate_content(user_content, generation_config=generation_config, stream=True)
    for chunk in response:
        if chunk.text:
            on_token(chunk.text)
    return response


@traceable(run_type="llm", name="gemini_structured_call")
def structured_call(system_prompt: str, user_content: str, response_schema: dict | None = None) -> dict:
    """One LLM call, forced JSON output. Caller validates shape with pydantic.

    response_schema is optional and additive -- every existing call site
    keeps working unchanged. Pass it for fields that control control-flow
    (which node runs next, who's authorized to decide) rather than display
    text: Gemini's response_schema constrains the model to only ever emit
    an enum member for that field, structurally, the same way LangGraph's
    own supervisor pattern (langchain-ai/langgraph-supervisor-py) makes an
    invalid handoff target unrepresentable via a tool-call contract instead
    of a string the caller has to validate after the fact. This app's
    hand-rolled "model returned unrecognized target, default to X" guards
    (manager_node, _valid_routing_decision) stay in place as defense in
    depth -- schema constraints are a real guarantee from Gemini, not a
    guarantee about every future model this app might point llm_model at.
    """
    settings = get_settings()
    _ensure_configured()
    model = genai.GenerativeModel(
        model_name=settings.llm_model,
        system_instruction=system_prompt,
    )

    run_id = events.current_run_id()
    node = events.current_node()
    on_token = None
    if run_id:
        def on_token(text: str, _run_id: str = run_id, _node: str | None = node) -> None:
            events.emit(_run_id, {"type": "llm_token", "node": _node, "text": text})

    generation_config = genai.GenerationConfig(
        temperature=0.2,
        response_mime_type="application/json",
        response_schema=response_schema,
    )
    response = _generate_content(
        model,
        user_content,
        generation_config,
        on_token=on_token,
    )

    # Without this, every trace's token count is 0 (confirmed against real
    # LangSmith data -- 100 traced runs, all zero) because Gemini's SDK
    # doesn't auto-populate it the way a LangChain chat model would. This
    # is the one piece of real usage data the call already has for free
    # (response.usage_metadata), just never surfaced -- attaching it here
    # is what makes "is token usage balanced between nodes" answerable
    # from LangSmith at all, instead of only from call counts.
    usage = getattr(response, "usage_metadata", None)
    if usage is not None:
        # total_token_count is not just prompt + candidates -- it also
        # folds in cached_content_token_count (tokens served from Gemini's
        # implicit context cache, billed at a steep discount off the input
        # rate rather than the full input or output price). Confirmed
        # against real payloads: every single call's total exceeded
        # input+output by a gap that lines up exactly with this field.
        # Dropping it silently is what made /admin/usage's totals not
        # reconcile with its own input+output columns -- captured here so
        # the dashboard can show all three instead of a mismatched total.
        cached_tokens = getattr(usage, "cached_content_token_count", 0) or 0
        run_tree = get_current_run_tree()
        if run_tree is not None:
            # LangSmith's UsageMetadata TypedDict rejects unknown top-level
            # keys outright (confirmed live: a bare "cached_tokens" key
            # broke every run with "Unexpected keys in usage metadata" as
            # soon as this started getting sent) -- cache tokens have to go
            # in the nested input_token_details.cache_read field its schema
            # actually defines, not a field of our own invention.
            run_tree.set(usage_metadata={
                "input_tokens": usage.prompt_token_count,
                "output_tokens": usage.candidates_token_count,
                "total_tokens": usage.total_token_count,
                "input_token_details": {"cache_read": cached_tokens},
            })
        events.add_token_usage(
            usage.prompt_token_count, usage.candidates_token_count, cached_tokens, usage.total_token_count,
        )

    return json.loads(response.text)
