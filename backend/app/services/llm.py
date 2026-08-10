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

from app.core.config import get_settings

_configured = False


def _ensure_configured() -> None:
    global _configured
    if not _configured:
        genai.configure(api_key=get_settings().gemini_api_key)
        _configured = True


def structured_call(system_prompt: str, user_content: str) -> dict:
    """One LLM call, forced JSON output. Caller validates shape with pydantic."""
    settings = get_settings()
    _ensure_configured()
    model = genai.GenerativeModel(
        model_name=settings.llm_model,
        system_instruction=system_prompt,
    )
    response = model.generate_content(
        user_content,
        generation_config=genai.GenerationConfig(
            temperature=0.2,
            response_mime_type="application/json",
        ),
    )
    return json.loads(response.text)
