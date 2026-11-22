from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..models import Incident, IncidentStatus, Organization, Service, ServiceStatus
from ..schemas import PublicIncident, PublicStatus

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
    names = {service.id: service.name for service in services}
    return PublicStatus(
        organization_name=organization.name,
        organization_slug=organization.slug,
        overall_status=overall,
        services=services,
        active_incidents=[_public_incident(incident, names) for incident in incidents],
        generated_at=datetime.now(timezone.utc),
    )


def _public_incident(incident: Incident, service_names: dict) -> PublicIncident:
    """Alert-opened incidents carry machine-generated titles (hostnames, IPs, queries), so the
    public page names only the affected service. Titles people wrote are shown as written."""
    public = PublicIncident.model_validate(incident)
    if incident.created_by_id is None:
        service = service_names.get(incident.service_id)
        public.title = f"Investigating an issue affecting {service}" if service else "Investigating an issue"
    return public
