from functools import lru_cache

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql://postgres:postgres@localhost:5432/agent_platform"
    gemini_api_key: str = ""
    llm_model: str = "gemini-2.0-flash"
    embedding_model: str = "models/gemini-embedding-001"
    allowed_origins: str = "http://localhost:3000"

    class Config:
        env_file = ".env"


@lru_cache
def get_settings() -> Settings:
    return Settings()
