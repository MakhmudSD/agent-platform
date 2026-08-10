"""
Thin embedding wrapper. One function, one place to swap providers —
mirrors the "provider is a config value, not a code path" principle.
"""
from __future__ import annotations

import google.generativeai as genai

from app.core.config import get_settings

_configured = False

# Matches the pgvector column dimension (Vector(1536)) in db/models.py.
_EMBEDDING_DIM = 1536


def _ensure_configured() -> None:
    global _configured
    if not _configured:
        genai.configure(api_key=get_settings().gemini_api_key)
        _configured = True


def embed_text(text: str) -> list[float]:
    settings = get_settings()
    _ensure_configured()
    response = genai.embed_content(
        model=settings.embedding_model,
        content=text.replace("\n", " "),
        output_dimensionality=_EMBEDDING_DIM,
    )
    return response["embedding"]
