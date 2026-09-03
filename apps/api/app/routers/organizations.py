import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import get_current_user, membership_for
from ..models import Incident, IncidentStatus, Service, ServiceStatus, Severity, User
from ..schemas import DashboardOverview

router = APIRouter(prefix="/organizations", tags=["organizations"])


@router.get("/{organization_id}/overview", response_model=DashboardOverview)
async def overview(
    organization_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DashboardOverview:
    await membership_for(db, user.id, organization_id)
    services = list((await db.scalars(
        select(Service).where(Service.organization_id == organization_id).order_by(Service.name)
    )).all())
    incidents = list((await db.scalars(
        select(Incident)
        .where(Incident.organization_id == organization_id)
        .order_by(Incident.created_at.desc())
        .limit(20)
    )).all())

    active_incidents = int(
        await db.scalar(
            select(func.count()).select_from(Incident).where(
                Incident.organization_id == organization_id,
                Incident.status != IncidentStatus.resolved,
            )
        )
        or 0
    )
    sev1_incidents = int(
        await db.scalar(
            select(func.count()).select_from(Incident).where(
                Incident.organization_id == organization_id,
                Incident.status != IncidentStatus.resolved,
                Incident.severity == Severity.sev1,
            )
        )
        or 0
    )

    return DashboardOverview(
        services_total=len(services),
        services_impacted=sum(service.status != ServiceStatus.operational for service in services),
        active_incidents=active_incidents,
        sev1_incidents=sev1_incidents,
        services=services,
        incidents=incidents,
    )
