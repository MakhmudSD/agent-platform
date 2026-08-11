"""
Standalone verification for retry/backoff on Gemini calls. Mocks the
underlying google.generativeai client only -- the real tenacity decorator
in services/llm.py and services/embedding.py runs for real.

Run with the backend venv active:
    python verify_retry_backoff.py
"""
from __future__ import annotations

import json
import sys
from unittest.mock import MagicMock, patch

from google.api_core.exceptions import ResourceExhausted


def test_structured_call_retries_on_429() -> bool:
    print("\n=== TEST 1: structured_call retries on 429, succeeds on 3rd attempt ===")
    from app.services import llm

    call_count = {"n": 0}

    def fake_generate_content(user_content, generation_config=None):
        call_count["n"] += 1
        if call_count["n"] < 3:
            raise ResourceExhausted("429 quota exceeded (simulated)")
        mock_response = MagicMock()
        mock_response.text = json.dumps({"ok": True, "attempt": call_count["n"]})
        return mock_response

    fake_model = MagicMock()
    fake_model.generate_content.side_effect = fake_generate_content

    with patch("app.services.llm.genai.GenerativeModel", return_value=fake_model), \
         patch("app.services.llm.genai.configure"):
        result = llm.structured_call("system prompt", "user content")

    print(f"  calls made: {call_count['n']}")
    print(f"  result: {result}")
    ok = call_count["n"] == 3 and result == {"ok": True, "attempt": 3}
    print(f"  RESULT: {'PASS' if ok else 'FAIL'}")
    return ok


def test_structured_call_does_not_retry_on_other_errors() -> bool:
    print("\n=== TEST 2: structured_call does NOT retry on non-429 errors ===")
    from app.services import llm

    call_count = {"n": 0}

    def fake_generate_content(user_content, generation_config=None):
        call_count["n"] += 1
        raise ValueError("some non-rate-limit error (simulated)")

    fake_model = MagicMock()
    fake_model.generate_content.side_effect = fake_generate_content

    ok = True
    with patch("app.services.llm.genai.GenerativeModel", return_value=fake_model), \
         patch("app.services.llm.genai.configure"):
        try:
            llm.structured_call("system prompt", "user content")
            ok = False
            print("  UNEXPECTED: no exception raised")
        except ValueError:
            pass

    print(f"  calls made (should be 1, no retries): {call_count['n']}")
    ok &= call_count["n"] == 1
    print(f"  RESULT: {'PASS' if ok else 'FAIL'}")
    return ok


def test_embed_text_retries_on_429() -> bool:
    print("\n=== TEST 3: embed_text retries on 429, succeeds on 3rd attempt ===")
    from app.services import embedding

    call_count = {"n": 0}

    def fake_embed_content(model, content, output_dimensionality):
        call_count["n"] += 1
        if call_count["n"] < 3:
            raise ResourceExhausted("429 quota exceeded (simulated)")
        return {"embedding": [0.1] * output_dimensionality}

    with patch("app.services.embedding.genai.embed_content", side_effect=fake_embed_content), \
         patch("app.services.embedding.genai.configure"):
        result = embedding.embed_text("some text")

    print(f"  calls made: {call_count['n']}")
    print(f"  result length: {len(result)}")
    ok = call_count["n"] == 3 and len(result) == 1536
    print(f"  RESULT: {'PASS' if ok else 'FAIL'}")
    return ok


def test_exhausts_after_3_attempts_and_reraises() -> bool:
    print("\n=== TEST 4: gives up after 3 attempts, re-raises the real exception ===")
    from app.services import llm

    call_count = {"n": 0}

    def always_429(user_content, generation_config=None):
        call_count["n"] += 1
        raise ResourceExhausted("429 quota exceeded (simulated, always fails)")

    fake_model = MagicMock()
    fake_model.generate_content.side_effect = always_429

    ok = True
    with patch("app.services.llm.genai.GenerativeModel", return_value=fake_model), \
         patch("app.services.llm.genai.configure"):
        try:
            llm.structured_call("system prompt", "user content")
            ok = False
            print("  UNEXPECTED: no exception raised")
        except ResourceExhausted:
            pass

    print(f"  calls made (should be capped at 3, not more): {call_count['n']}")
    ok &= call_count["n"] == 3
    print(f"  RESULT: {'PASS' if ok else 'FAIL'}")
    return ok


if __name__ == "__main__":
    results = {
        "retries_on_429_then_succeeds": test_structured_call_retries_on_429(),
        "does_not_retry_on_other_errors": test_structured_call_does_not_retry_on_other_errors(),
        "embed_text_retries_on_429": test_embed_text_retries_on_429(),
        "exhausts_after_3_and_reraises": test_exhausts_after_3_attempts_and_reraises(),
    }
    print("\n=== SUMMARY ===")
    for name, passed in results.items():
        print(f"  {name}: {'PASS' if passed else 'FAIL'}")
    sys.exit(0 if all(results.values()) else 1)
