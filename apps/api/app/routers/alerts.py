import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import get_current_user, require_role
from ..integrations import queue_webhook_event
from ..models import Alert, Incident, IncidentEvent, Role, Service, ServiceStatus, User
from ..realtime import manager
from ..schemas import IncidentOut, SimulationRequest
from ..worker import dispatch_incident_notification

router = APIRouter(prefix="/organizations/{organization_id}/alerts", tags=["alerts"])


@router.post("/simulate", response_model=IncidentOut, status_code=status.HTTP_201_CREATED)
async def simulate_outage(
    organization_id: uuid.UUID,
    payload: SimulationRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Incident:
    await require_role(db, user.id, organization_id, {Role.owner, Role.admin, Role.engineer})
    service = await db.get(Service, payload.service_id)
    if service is None or service.organization_id != organization_id:
        raise HTTPException(status_code=404, detail="Service not found")

    service.status = ServiceStatus.outage
    incident = Incident(
        organization_id=organization_id,
        service_id=service.id,
        created_by_id=user.id,
        commander_id=user.id,
        title=payload.title,
        summary=f"Automatically opened after a simulated critical alert for {service.name}.",
        severity=payload.severity,
    )
    db.add(incident)
    await db.flush()
    alert = Alert(
        organization_id=organization_id,
        service_id=service.id,
        incident_id=incident.id,
        source="aegis-simulator",
        fingerprint=f"simulation:{service.id}",
        title=payload.title,
        description="Synthetic alert used to exercise the complete incident workflow.",
        severity=payload.severity,
        payload={"simulated": True},
    )
    db.add(alert)
    db.add(IncidentEvent(
        incident_id=incident.id,
        actor_id=user.id,
        event_type="alert.triggered",
        message=f"Critical alert received for {service.name}; incident created automatically.",
        event_metadata={"source": "aegis-simulator", "service_id": str(service.id)},
    ))
    await db.commit()
    await db.refresh(incident)
    dispatch_incident_notification.delay(str(organization_id), str(incident.id), incident.title)
    await queue_webhook_event(
        db,
        organization_id,
        "alert.triggered",
        {
            "alert_id": str(alert.id),
            "incident_id": str(incident.id),
            "service_id": str(service.id),
            "service_slug": service.slug,
            "title": alert.title,
            "severity": alert.severity.value,
            "source": alert.source,
            "simulated": True,
        },
    )
    await manager.broadcast(organization_id, {
        "type": "alert.triggered",
        "service_id": str(service.id),
        "incident_id": str(incident.id),
    })
    return incident
