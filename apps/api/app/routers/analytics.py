import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import get_current_user, membership_for
from ..models import Incident, IncidentStatus, Service, ServiceStatus, Severity, User
from ..schemas import AnalyticsOverview

router = APIRouter(prefix="/organizations/{organization_id}/analytics", tags=["analytics"])


@router.get("/overview", response_model=AnalyticsOverview)
async def analytics_overview(
    organization_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AnalyticsOverview:
    await membership_for(db, user.id, organization_id)
    since = datetime.now(timezone.utc) - timedelta(days=30)

    incidents_30d = int(
        await db.scalar(
            select(func.count()).select_from(Incident).where(
                Incident.organization_id == organization_id,
                Incident.created_at >= since,
            )
        )
        or 0
    )
    sev1_30d = int(
        await db.scalar(
            select(func.count()).select_from(Incident).where(
                Incident.organization_id == organization_id,
                Incident.created_at >= since,
                Incident.severity == Severity.sev1,
            )
        )
        or 0
    )
    resolved_rows = (
        await db.execute(
            select(Incident.created_at, Incident.resolved_at).where(
                Incident.organization_id == organization_id,
                Incident.created_at >= since,
                Incident.resolved_at.is_not(None),
            )
        )
    ).all()
    durations = [
        max(0, (resolved_at - created_at).total_seconds() / 60)
        for created_at, resolved_at in resolved_rows
        if resolved_at is not None
    ]
    current_active = int(
        await db.scalar(
            select(func.count()).select_from(Incident).where(
                Incident.organization_id == organization_id,
                Incident.status != IncidentStatus.resolved,
            )
        )
        or 0
    )
    current_impacted_services = int(
        await db.scalar(
            select(func.count()).select_from(Service).where(
                Service.organization_id == organization_id,
                Service.status != ServiceStatus.operational,
            )
        )
        or 0
    )

    return AnalyticsOverview(
        incidents_30d=incidents_30d,
        resolved_30d=len(resolved_rows),
        sev1_30d=sev1_30d,
        mean_time_to_resolve_minutes=round(sum(durations) / len(durations), 1) if durations else None,
        current_active=current_active,
        current_impacted_services=current_impacted_services,
    )
