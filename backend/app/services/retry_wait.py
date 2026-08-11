"""
Shared tenacity wait-strategy for Gemini rate-limit retries.

Google's REST error body for a 429 embeds its own suggested wait as a
RetryInfo detail (e.g. {"@type": ".../google.rpc.RetryInfo", "retryDelay":
"12.771204034s"}), surfaced by google-api-core as plain dicts on
ResourceExhausted.details. Honoring that number is more reliable than a
fixed exponential curve -- the two real 429s this app has hit came back
with 12s and 53s suggested delays, either of which a short fixed backoff
would burn through without the quota window actually reopening.
"""
from __future__ import annotations

import re

from google.api_core.exceptions import ResourceExhausted

_RETRY_DELAY_RE = re.compile(r"^([\d.]+)s?$")
_FALLBACK_SECONDS = 5.0
_MAX_SECONDS = 65.0


def _server_suggested_delay(exc: ResourceExhausted) -> float | None:
    for detail in exc.details:
        if not isinstance(detail, dict):
            continue
        raw = detail.get("retryDelay")
        if not raw:
            continue
        match = _RETRY_DELAY_RE.match(str(raw).strip())
        if match:
            return float(match.group(1))
    return None


def wait_for_server_retry_delay(retry_state) -> float:
    exc = retry_state.outcome.exception() if retry_state.outcome else None
    if isinstance(exc, ResourceExhausted):
        delay = _server_suggested_delay(exc)
        if delay is not None:
            return min(delay + 1.0, _MAX_SECONDS)  # +1s buffer past the window close
    return _FALLBACK_SECONDS
