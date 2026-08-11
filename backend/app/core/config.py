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
    llm_model: str = "gemini-2.0-flash"
    embedding_model: str = "models/gemini-embedding-001"
    allowed_origins: str = "http://localhost:3000"

    class Config:
        env_file = ".env"
        extra = "ignore"  # tracing vars (LANGCHAIN_*) are for os.environ, not Settings fields


@lru_cache
def get_settings() -> Settings:
    return Settings()
