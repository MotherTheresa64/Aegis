import asyncio
from pathlib import Path

from alembic import command
from alembic.config import Config


def _upgrade_to_head() -> None:
    config_path = Path(__file__).resolve().parent.parent / "alembic.ini"
    config = Config(str(config_path))
    command.upgrade(config, "head")


async def run_migrations() -> None:
    await asyncio.to_thread(_upgrade_to_head)
