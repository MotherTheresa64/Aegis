from collections.abc import AsyncIterator
from datetime import datetime, timezone

from sqlalchemy import DateTime
from sqlalchemy.types import TypeDecorator
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from .config import settings


class Base(DeclarativeBase):
    pass


engine = create_async_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_db() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session


class UTCDateTime(TypeDecorator):
    """Timezone-aware DateTime that always loads as UTC.

    SQLite (development and CI) stores datetimes without an offset, so values came back
    naive and clients parsed them as local time. PostgreSQL behaviour is unchanged.
    """

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_result_value(self, value: datetime | None, dialect) -> datetime | None:
        if value is not None and value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value
