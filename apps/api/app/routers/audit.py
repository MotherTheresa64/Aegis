import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import get_current_user, require_role
from ..models import AuditEvent, Role, User
from ..schemas import AuditEventOut

router = APIRouter(prefix="/organizations/{organization_id}/audit", tags=["audit"])


@router.get("", response_model=list[AuditEventOut])
async def list_audit_events(
    organization_id: uuid.UUID,
    limit: int = Query(default=50, ge=1, le=100),
    before: datetime | None = Query(default=None),
    action: str | None = Query(default=None, min_length=1, max_length=120),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[AuditEvent]:
    await require_role(db, user.id, organization_id, {Role.owner, Role.admin})

    statement = select(AuditEvent).where(AuditEvent.organization_id == organization_id)
    if before is not None:
        statement = statement.where(AuditEvent.created_at < before)
    if action is not None:
        statement = statement.where(AuditEvent.action == action.strip())

    result = await db.execute(
        statement.order_by(AuditEvent.created_at.desc(), AuditEvent.id.desc()).limit(limit)
    )
    return list(result.scalars())
