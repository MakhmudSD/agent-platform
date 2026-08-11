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


def _fake_429(message: str, retry_delay_seconds: float) -> ResourceExhausted:
    """Builds a ResourceExhausted carrying the same RetryInfo detail shape
    Google's REST error body actually returns, so tests exercise the real
    parsing path in app/services/retry_wait.py instead of only the fallback."""
    return ResourceExhausted(
        message,
        details=[{
            "@type": "type.googleapis.com/google.rpc.RetryInfo",
            "retryDelay": f"{retry_delay_seconds}s",
        }],
    )


def test_structured_call_retries_on_429() -> bool:
    print("\n=== TEST 1: structured_call retries on 429, succeeds on 3rd attempt ===")
    from app.services import llm

    call_count = {"n": 0}

    def fake_generate_content(user_content, generation_config=None):
        call_count["n"] += 1
        if call_count["n"] < 3:
            raise _fake_429("429 quota exceeded (simulated)", 0.05)
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
            raise _fake_429("429 quota exceeded (simulated)", 0.05)
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
        raise _fake_429("429 quota exceeded (simulated, always fails)", 0.05)

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


def test_wait_honors_server_retry_delay() -> bool:
    print("\n=== TEST 5: wait function uses the server's own retryDelay, not a short fixed curve ===")
    from unittest.mock import MagicMock

    from app.services.retry_wait import wait_for_server_retry_delay

    def wait_for(exc) -> float:
        state = MagicMock()
        state.outcome.exception.return_value = exc
        return wait_for_server_retry_delay(state)

    # Real cases pulled from actual 429s this app has hit: 12s and 53s.
    w12 = wait_for(_fake_429("quota", 12.771204034))
    w53 = wait_for(_fake_429("quota", 53.0))
    w_no_details = wait_for(ResourceExhausted("quota, no details"))
    w_over_cap = wait_for(_fake_429("quota", 500))

    print(f"  wait for 12.77s server delay: {w12} (expect ~13.77)")
    print(f"  wait for 53s server delay: {w53} (expect ~54)")
    print(f"  wait with no details (fallback): {w_no_details} (expect 5.0)")
    print(f"  wait for 500s server delay (capped): {w_over_cap} (expect <= 65)")

    ok = (
        abs(w12 - 13.771204034) < 1e-6
        and abs(w53 - 54.0) < 1e-6
        and w_no_details == 5.0
        and w_over_cap <= 65.0
    )
    print(f"  RESULT: {'PASS' if ok else 'FAIL'}")
    return ok


if __name__ == "__main__":
    results = {
        "retries_on_429_then_succeeds": test_structured_call_retries_on_429(),
        "does_not_retry_on_other_errors": test_structured_call_does_not_retry_on_other_errors(),
        "embed_text_retries_on_429": test_embed_text_retries_on_429(),
        "exhausts_after_3_and_reraises": test_exhausts_after_3_attempts_and_reraises(),
        "wait_honors_server_retry_delay": test_wait_honors_server_retry_delay(),
    }
    print("\n=== SUMMARY ===")
    for name, passed in results.items():
        print(f"  {name}: {'PASS' if passed else 'FAIL'}")
    sys.exit(0 if all(results.values()) else 1)
