from functools import lru_cache

from dotenv import load_dotenv
from pydantic_settings import BaseSettings

# LangSmith/langchain-core read tracing config (LANGCHAIN_TRACING_V2 etc.)
# straight from os.environ, not from our Settings object — pydantic-settings
# parsing .env only populates Settings' own fields, it doesn't export to the
# process environment. load_dotenv() actually does.
load_dotenv()


class Settings(BaseSettings):
    database_url: str = "postgresql://postgres:postgres@localhost:5432/agent_platform"
    gemini_api_key: str = ""
    # Was "gemini-flash-latest" -- a floating alias Google silently
    # repoints, confirmed live on 2026-08-19 to already be serving
    # gemini-3.6-flash (a "thinking" model: usage_metadata.total_token_count
    # runs well above prompt+candidates because of a hidden reasoning-token
    # cost the SDK doesn't surface as its own field -- see _row() in
    # routes/admin.py for how that gap is billed). Pinned to a concrete,
    # dated model name so a Google-side repoint can't silently change what's
    # served, what it costs, or what capabilities (thinking, caching) apply
    # out from under this codebase again. Re-verify this pin and the prices
    # below whenever Google deprecates it (404 with a "no longer available"
    # message names the replacement, same as it did for gemini-2.5-flash).
    llm_model: str = "gemini-3.6-flash"
    embedding_model: str = "models/gemini-embedding-001"
    # Published per-1M-token pricing, USD, confirmed against
    # ai.google.dev/gemini-api/docs/pricing on 2026-08-19 for gemini-3.6-flash
    # (introductory pricing through 2026-12-31; rises to $1.50/$7.50 on
    # 2027-01-01 -- update these then). Output price already covers thinking
    # tokens per Google's own pricing page ("Output price (including
    # thinking tokens)"), which is why _row() bills the reasoning-token gap
    # at the output rate rather than leaving it uncosted.
    llm_input_price_per_million_usd: float = 0.75
    llm_output_price_per_million_usd: float = 3.75
    # Manual, not live-fetched -- a KRW display figure that moves with every
    # request would make cost figures impossible to compare across the
    # admin dashboard. Checked manually on 2026-08-19; update by hand if it
    # drifts significantly.
    krw_per_usd: float = 1413.0
    allowed_origins: str = "http://localhost:3000"

    # Dev-only default -- MUST be overridden via env var (JWT_SECRET_KEY) in
    # any environment reachable by anyone but the developer; every session
    # cookie is forgeable by anyone who knows this value.
    jwt_secret_key: str = "dev-insecure-secret-change-in-production"
    jwt_expire_minutes: int = 60 * 24 * 7  # 7 days -- demo convenience, not a security choice

    class Config:
        env_file = ".env"
        extra = "ignore"  # tracing vars (LANGCHAIN_*) are for os.environ, not Settings fields


@lru_cache
def get_settings() -> Settings:
    return Settings()
