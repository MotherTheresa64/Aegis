from app.config import normalize_database_url


def test_normalizes_neon_postgres_url_for_asyncpg() -> None:
    raw = (
        "postgresql://user:pass@example.neon.tech/neondb"
        "?sslmode=require&channel_binding=require"
    )

    normalized = normalize_database_url(raw)

    assert normalized.startswith("postgresql+asyncpg://")
    assert "sslmode=require" in normalized
    assert "channel_binding" not in normalized


def test_leaves_sqlite_url_unchanged() -> None:
    raw = "sqlite+aiosqlite:///./aegis.db"
    assert normalize_database_url(raw) == raw
