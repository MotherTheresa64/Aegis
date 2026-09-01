import pytest
from pydantic import ValidationError

from app.config import Settings, normalize_database_url


def test_normalizes_neon_postgres_url_for_asyncpg() -> None:
    raw = (
        "postgresql://user:pass@example.neon.tech/neondb"
        "?sslmode=require&channel_binding=require"
    )

    normalized = normalize_database_url(raw)

    assert normalized.startswith("postgresql+asyncpg://")
    assert "ssl=require" in normalized
    assert "sslmode" not in normalized
    assert "channel_binding" not in normalized


def test_leaves_sqlite_url_unchanged() -> None:
    raw = "sqlite+aiosqlite:///./aegis.db"
    assert normalize_database_url(raw) == raw


def test_production_rejects_default_secret() -> None:
    with pytest.raises(ValidationError, match="AEGIS_SECRET_KEY"):
        Settings(
            aegis_env="production",
            aegis_secret_key="development-only-secret",
            aegis_cors_origins=["https://aegis.example"],
            _env_file=None,
        )


def test_production_rejects_wildcard_cors() -> None:
    with pytest.raises(ValidationError, match="AEGIS_CORS_ORIGINS"):
        Settings(
            aegis_env="production",
            aegis_secret_key="a" * 48,
            aegis_cors_origins=["*"],
            _env_file=None,
        )


def test_production_accepts_explicit_safe_configuration() -> None:
    settings = Settings(
        aegis_env="production",
        aegis_secret_key="a" * 48,
        aegis_cors_origins=["https://aegis.example"],
        _env_file=None,
    )
    assert settings.aegis_env == "production"
