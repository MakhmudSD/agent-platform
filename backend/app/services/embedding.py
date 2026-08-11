"""
Thin embedding wrapper. One function, one place to swap providers —
mirrors the "provider is a config value, not a code path" principle.
"""
from __future__ import annotations

import google.generativeai as genai
from google.api_core.exceptions import ResourceExhausted
from langsmith import traceable
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from app.core.config import get_settings

_configured = False

# Matches the pgvector column dimension (Vector(1536)) in db/models.py.
_EMBEDDING_DIM = 1536


def _ensure_configured() -> None:
    global _configured
    if not _configured:
        genai.configure(api_key=get_settings().gemini_api_key)
        _configured = True


# Same rationale as llm.py's _generate_content: ResourceExhausted is the
# real 429 type, confirmed against an actual traceback, not assumed.
@retry(
    retry=retry_if_exception_type(ResourceExhausted),
    wait=wait_exponential(multiplier=1, min=1, max=10),
    stop=stop_after_attempt(3),
    reraise=True,
)
def _embed_content(model: str, content: str, output_dimensionality: int):
    return genai.embed_content(model=model, content=content, output_dimensionality=output_dimensionality)


@traceable(run_type="embedding", name="gemini_embed_text")
def embed_text(text: str) -> list[float]:
    settings = get_settings()
    _ensure_configured()
    response = _embed_content(settings.embedding_model, text.replace("\n", " "), _EMBEDDING_DIM)
    return response["embedding"]
