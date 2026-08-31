import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..db import get_db
from ..deps import get_current_user, membership_for, require_role
from ..integrations import queue_webhook_event
from ..models import AuditEvent, Incident, IncidentEvent, IncidentStatus, Role, Service, ServiceStatus, User
from ..realtime import manager
from ..schemas import IncidentCreate, IncidentDetail, IncidentEventCreate, IncidentOut, IncidentStatusUpdate
from ..worker import dispatch_incident_notification

router = APIRouter(prefix="/organizations/{organization_id}/incidents", tags=["incidents"])


@router.get("", response_model=list[IncidentOut])
async def list_incidents(
    organization_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[Incident]:
    await membership_for(db, user.id, organization_id)
    result = await db.execute(
        select(Incident)
        .where(Incident.organization_id == organization_id)
        .order_by(Incident.created_at.desc())
        .limit(100)
    )
    return list(result.scalars())


@router.post("", response_model=IncidentOut, status_code=status.HTTP_201_CREATED)
async def create_incident(
    organization_id: uuid.UUID,
    payload: IncidentCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Incident:
    await require_role(db, user.id, organization_id, {Role.owner, Role.admin, Role.engineer, Role.responder})
    if payload.service_id:
        service = await db.get(Service, payload.service_id)
        if service is None or service.organization_id != organization_id:
            raise HTTPException(status_code=404, detail="Service not found")
        if service.status == ServiceStatus.operational:
            service.status = ServiceStatus.degraded

    incident = Incident(
        organization_id=organization_id,
        service_id=payload.service_id,
        created_by_id=user.id,
        commander_id=user.id,
        title=payload.title.strip(),
        summary=payload.summary.strip(),
        severity=payload.severity,
    )
    db.add(incident)
    await db.flush()
    db.add(IncidentEvent(
        incident_id=incident.id,
        actor_id=user.id,
        event_type="incident.created",
        message=f"Incident declared by {user.full_name}",
    ))
    db.add(AuditEvent(
        organization_id=organization_id,
        actor_id=user.id,
        action="incident.created",
        resource_type="incident",
        resource_id=str(incident.id),
        details={"severity": incident.severity.value, "title": incident.title},
    ))
    await db.commit()
    await db.refresh(incident)
    await queue_webhook_event(
        db,
        organization_id,
        "incident.created",
        {
            "incident_id": str(incident.id),
            "service_id": str(incident.service_id) if incident.service_id else None,
            "title": incident.title,
            "severity": incident.severity.value,
            "status": incident.status.value,
        },
    )
    dispatch_incident_notification.delay(str(organization_id), str(incident.id), incident.title)
    await manager.broadcast(organization_id, {"type": "incident.created", "incident_id": str(incident.id)})
    return incident


@router.get("/{incident_id}", response_model=IncidentDetail)
async def get_incident(
    organization_id: uuid.UUID,
    incident_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Incident:
    await membership_for(db, user.id, organization_id)
    result = await db.execute(
        select(Incident)
        .options(selectinload(Incident.events), selectinload(Incident.tasks))
        .where(Incident.id == incident_id, Incident.organization_id == organization_id)
    )
    incident = result.scalar_one_or_none()
    if incident is None:
        raise HTTPException(status_code=404, detail="Incident not found")
    return incident


@router.post("/{incident_id}/events", response_model=IncidentDetail)
async def add_incident_event(
    organization_id: uuid.UUID,
    incident_id: uuid.UUID,
    payload: IncidentEventCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Incident:
    await require_role(db, user.id, organization_id, {Role.owner, Role.admin, Role.engineer, Role.responder})
    incident = await db.get(Incident, incident_id)
    if incident is None or incident.organization_id != organization_id:
        raise HTTPException(status_code=404, detail="Incident not found")
    db.add(IncidentEvent(
        incident_id=incident.id,
        actor_id=user.id,
        event_type="note.added",
        message=payload.message.strip(),
    ))
    await db.commit()
    result = await db.execute(
        select(Incident)
        .options(selectinload(Incident.events), selectinload(Incident.tasks))
        .where(Incident.id == incident.id)
    )
    refreshed = result.scalar_one()
    await manager.broadcast(organization_id, {"type": "incident.event_added", "incident_id": str(incident.id)})
    return refreshed


@router.patch("/{incident_id}/status", response_model=IncidentOut)
async def update_incident_status(
    organization_id: uuid.UUID,
    incident_id: uuid.UUID,
    payload: IncidentStatusUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Incident:
    await require_role(db, user.id, organization_id, {Role.owner, Role.admin, Role.engineer, Role.responder})
    incident = await db.get(Incident, incident_id)
    if incident is None or incident.organization_id != organization_id:
        raise HTTPException(status_code=404, detail="Incident not found")

    previous = incident.status.value
    incident.status = payload.status
    if payload.status == IncidentStatus.resolved:
        incident.resolved_at = datetime.now(timezone.utc)
        if incident.service_id:
            service = await db.get(Service, incident.service_id)
            if service and service.organization_id == organization_id:
                service.status = ServiceStatus.operational

    message = payload.message or f"Status changed from {previous} to {payload.status.value}"
    db.add(IncidentEvent(
        incident_id=incident.id,
        actor_id=user.id,
        event_type="incident.status_changed",
        message=message,
        event_metadata={"from": previous, "to": payload.status.value},
    ))
    db.add(AuditEvent(
        organization_id=organization_id,
        actor_id=user.id,
        action="incident.status_changed",
        resource_type="incident",
        resource_id=str(incident.id),
        details={"from": previous, "to": payload.status.value},
    ))
    await db.commit()
    await db.refresh(incident)
    webhook_type = "incident.resolved" if incident.status == IncidentStatus.resolved else "incident.updated"
    await queue_webhook_event(
        db,
        organization_id,
        webhook_type,
        {
            "incident_id": str(incident.id),
            "service_id": str(incident.service_id) if incident.service_id else None,
            "from": previous,
            "to": incident.status.value,
            "message": message,
        },
    )
    await manager.broadcast(organization_id, {"type": "incident.updated", "incident_id": str(incident.id)})
    return incident
