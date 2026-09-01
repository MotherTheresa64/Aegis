from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..models import Incident, IncidentStatus, Organization, Service, ServiceStatus
from ..schemas import PublicStatus

router = APIRouter(prefix="/status", tags=["public status"])


@router.get("/{organization_slug}", response_model=PublicStatus)
async def public_status(organization_slug: str, db: AsyncSession = Depends(get_db)) -> PublicStatus:
    organization = await db.scalar(select(Organization).where(Organization.slug == organization_slug))
    if organization is None:
        raise HTTPException(status_code=404, detail="Status page not found")
    services = list((await db.scalars(
        select(Service).where(Service.organization_id == organization.id).order_by(Service.name)
    )).all())
    incidents = list((await db.scalars(
        select(Incident).where(
            Incident.organization_id == organization.id,
            Incident.status != IncidentStatus.resolved,
        ).order_by(Incident.created_at.desc()).limit(50)
    )).all())
    if any(service.status == ServiceStatus.outage for service in services):
        overall = ServiceStatus.outage
    elif any(service.status == ServiceStatus.degraded for service in services):
        overall = ServiceStatus.degraded
    elif any(service.status == ServiceStatus.maintenance for service in services):
        overall = ServiceStatus.maintenance
    else:
        overall = ServiceStatus.operational
    return PublicStatus(
        organization_name=organization.name,
        organization_slug=organization.slug,
        overall_status=overall,
        services=services,
        active_incidents=incidents,
        generated_at=datetime.now(timezone.utc),
    )
