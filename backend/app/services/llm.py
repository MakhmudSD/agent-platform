"""
Thin LLM wrapper. Structured (JSON-mode) calls only — the orchestrator
never parses free text to decide what to do next, it asks the model for
a typed decision. This is the same "structured outputs over regex parsing"
lesson from Lexara's llm_service.py, applied to agent control flow instead
of chat responses.
"""
from __future__ import annotations

import json

import google.generativeai as genai
from google.api_core.exceptions import ResourceExhausted
from langsmith import traceable
from tenacity import retry, retry_if_exception_type, stop_after_attempt

from app.core.config import get_settings
from app.services.retry_wait import wait_for_server_retry_delay

_configured = False


def _ensure_configured() -> None:
    global _configured
    if not _configured:
        genai.configure(api_key=get_settings().gemini_api_key)
        _configured = True


# ResourceExhausted (google.api_core.exceptions) is what google.generativeai
# actually raises for a 429 -- confirmed against the real traceback from the
# quota wall we hit two sessions ago, not assumed. Retrying on anything else
# (bad request, auth failure) would just burn 3x the time before failing the
# same way, so this is deliberately narrow.
#
# Wait time comes from the server's own RetryInfo.retryDelay (Google told us
# 12s and 53s on the two real 429s we've hit), not a fixed exponential curve --
# a short fixed backoff burns all 3 attempts inside a still-closed quota
# window and fails anyway, just slower and with 3x the API calls.
@retry(
    retry=retry_if_exception_type(ResourceExhausted),
    wait=wait_for_server_retry_delay,
    stop=stop_after_attempt(3),
    reraise=True,
)
def _generate_content(model: "genai.GenerativeModel", user_content: str, generation_config: "genai.GenerationConfig"):
    return model.generate_content(user_content, generation_config=generation_config)


@traceable(run_type="llm", name="gemini_structured_call")
def structured_call(system_prompt: str, user_content: str) -> dict:
    """One LLM call, forced JSON output. Caller validates shape with pydantic."""
    settings = get_settings()
    _ensure_configured()
    model = genai.GenerativeModel(
        model_name=settings.llm_model,
        system_instruction=system_prompt,
    )
    response = _generate_content(
        model,
        user_content,
        genai.GenerationConfig(temperature=0.2, response_mime_type="application/json"),
    )
    return json.loads(response.text)
