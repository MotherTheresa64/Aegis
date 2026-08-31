import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import select
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
    incidents = list((await db.scalars(select(Incident).where(
        Incident.organization_id == organization_id,
        Incident.created_at >= since,
    ))).all())
    resolved = [i for i in incidents if i.resolved_at is not None]
    durations = [max(0, (i.resolved_at - i.created_at).total_seconds() / 60) for i in resolved if i.resolved_at]
    active_now = list((await db.scalars(select(Incident).where(
        Incident.organization_id == organization_id,
        Incident.status != IncidentStatus.resolved,
    ))).all())
    impacted = list((await db.scalars(select(Service).where(
        Service.organization_id == organization_id,
        Service.status != ServiceStatus.operational,
    ))).all())
    return AnalyticsOverview(
        incidents_30d=len(incidents),
        resolved_30d=len(resolved),
        sev1_30d=sum(i.severity == Severity.sev1 for i in incidents),
        mean_time_to_resolve_minutes=round(sum(durations) / len(durations), 1) if durations else None,
        current_active=len(active_now),
        current_impacted_services=len(impacted),
    )
