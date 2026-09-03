"""Allow incidents created by automated integrations to have no human creator.

Revision ID: 20260901_0002
Revises: 20260831_0001
Create Date: 2026-09-01
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260901_0002"
down_revision: str | Sequence[str] | None = "20260831_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("incidents") as batch_op:
        batch_op.alter_column(
            "created_by_id",
            existing_type=sa.Uuid(),
            nullable=True,
        )


def downgrade() -> None:
    connection = op.get_bind()
    null_creators = connection.execute(
        sa.text("SELECT COUNT(*) FROM incidents WHERE created_by_id IS NULL")
    ).scalar_one()
    if null_creators:
        raise RuntimeError(
            "Cannot downgrade while system-attributed incidents exist; assign creators first."
        )
    with op.batch_alter_table("incidents") as batch_op:
        batch_op.alter_column(
            "created_by_id",
            existing_type=sa.Uuid(),
            nullable=False,
        )
