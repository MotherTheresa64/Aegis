"""Baseline the current Aegis schema.

Revision ID: 20260831_0001
Revises:
Create Date: 2026-08-31
"""
from collections.abc import Sequence

from alembic import op

from app import collaboration_models, integration_models, models  # noqa: F401
from app.db import Base

revision: str = "20260831_0001"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    Base.metadata.create_all(bind=op.get_bind(), checkfirst=True)


def downgrade() -> None:
    Base.metadata.drop_all(bind=op.get_bind(), checkfirst=True)
