from functools import lru_cache
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def normalize_database_url(value: str) -> str:
    if value.startswith("postgresql://"):
        value = value.replace("postgresql://", "postgresql+asyncpg://", 1)

    if not value.startswith("postgresql+asyncpg://"):
        return value

    parts = urlsplit(value)
    query: list[tuple[str, str]] = []
    for key, item in parse_qsl(parts.query, keep_blank_values=True):
        if key == "channel_binding":
            continue
        if key == "sslmode":
            key = "ssl"
        query.append((key, item))

    return urlunsplit(
        (parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment)
    )


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    aegis_env: str = "development"
    aegis_secret_key: str = "development-only-secret"
    aegis_access_token_minutes: int = 60
    aegis_cors_origins: list[str] | str = ["http://localhost:5173"]
    aegis_inline_jobs: bool = False
    aegis_realtime_ticket_seconds: int = 60

    database_url: str = "sqlite+aiosqlite:///./aegis.db"
    redis_url: str = "redis://localhost:6379/0"
    celery_broker_url: str = "redis://localhost:6379/1"
    celery_result_backend: str = "redis://localhost:6379/2"

    @field_validator("aegis_cors_origins", mode="before")
    @classmethod
    def parse_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @field_validator("database_url", mode="before")
    @classmethod
    def normalize_database_connection(cls, value: object) -> object:
        if isinstance(value, str):
            return normalize_database_url(value)
        return value

    @model_validator(mode="after")
    def validate_production_safety(self) -> "Settings":
        if self.aegis_env.lower() != "production":
            return self

        if self.aegis_secret_key == "development-only-secret" or len(self.aegis_secret_key) < 32:
            raise ValueError("AEGIS_SECRET_KEY must be a non-default value of at least 32 characters in production")

        origins = self.aegis_cors_origins
        if isinstance(origins, str):
            origins = [origins]
        if not origins or "*" in origins:
            raise ValueError("AEGIS_CORS_ORIGINS must explicitly list allowed origins in production")

        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
