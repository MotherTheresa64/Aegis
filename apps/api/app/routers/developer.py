import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import get_current_user, require_role
from ..integrations import queue_webhook_event
from ..models import Alert, ApiKey, AuditEvent, Incident, IncidentEvent, IncidentStatus, Role, Service, ServiceStatus, User
from ..realtime import manager
from ..schemas import AlertIngest, ApiKeyCreate, ApiKeyCreated, ApiKeySummary, IncidentOut
from ..security import hash_api_key, issue_api_key
from ..worker import enqueue_incident_notification

router = APIRouter(tags=["developer"])


@router.get("/organizations/{organization_id}/api-keys", response_model=list[ApiKeySummary])
async def list_api_keys(
    organization_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ApiKey]:
    await require_role(db, user.id, organization_id, {Role.owner, Role.admin})
    result = await db.execute(
        select(ApiKey).where(ApiKey.organization_id == organization_id).order_by(ApiKey.created_at.desc())
    )
    return list(result.scalars())


@router.post("/organizations/{organization_id}/api-keys", response_model=ApiKeyCreated, status_code=status.HTTP_201_CREATED)
async def create_api_key(
    organization_id: uuid.UUID,
    payload: ApiKeyCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ApiKeyCreated:
    await require_role(db, user.id, organization_id, {Role.owner, Role.admin})
    raw, prefix, digest = issue_api_key()
    key = ApiKey(organization_id=organization_id, name=payload.name, key_prefix=prefix, key_hash=digest)
    db.add(key)
    await db.flush()
    db.add(AuditEvent(
        organization_id=organization_id,
        actor_id=user.id,
        action="developer.api_key_created",
        resource_type="api_key",
        resource_id=str(key.id),
        details={"name": key.name, "key_prefix": key.key_prefix},
    ))
    await db.commit()
    await db.refresh(key)
    return ApiKeyCreated(
        id=key.id,
        name=key.name,
        key_prefix=key.key_prefix,
        last_used_at=key.last_used_at,
        created_at=key.created_at,
        key=raw,
    )


@router.delete("/organizations/{organization_id}/api-keys/{api_key_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_api_key(
    organization_id: uuid.UUID,
    api_key_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    await require_role(db, user.id, organization_id, {Role.owner, Role.admin})
    key = await db.scalar(
        select(ApiKey).where(
            ApiKey.id == api_key_id,
            ApiKey.organization_id == organization_id,
        )
    )
    if key is None:
        raise HTTPException(status_code=404, detail="API key not found")

    db.add(AuditEvent(
        organization_id=organization_id,
        actor_id=user.id,
        action="developer.api_key_revoked",
        resource_type="api_key",
        resource_id=str(key.id),
        details={"name": key.name, "key_prefix": key.key_prefix},
    ))
    await db.delete(key)
    await db.commit()


@router.post("/alerts/ingest", response_model=IncidentOut, status_code=status.HTTP_202_ACCEPTED)
async def ingest_alert(
    payload: AlertIngest,
    x_aegis_key: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> Incident:
    if not x_aegis_key:
        raise HTTPException(status_code=401, detail="X-Aegis-Key is required")
    key = await db.scalar(select(ApiKey).where(ApiKey.key_hash == hash_api_key(x_aegis_key)))
    if key is None:
        raise HTTPException(status_code=401, detail="Invalid API key")

    key.last_used_at = datetime.now(timezone.utc)
    service = await db.scalar(
        select(Service).where(Service.organization_id == key.organization_id, Service.slug == payload.service_slug)
    )
    if service is None:
        raise HTTPException(status_code=404, detail="Service slug not found")

    if payload.fingerprint:
        existing = await db.scalar(
            select(Incident)
            .join(Alert, Alert.incident_id == Incident.id)
            .where(
                Alert.organization_id == key.organization_id,
                Alert.service_id == service.id,
                Alert.source == payload.source,
                Alert.fingerprint == payload.fingerprint,
                Incident.status != IncidentStatus.resolved,
            )
            .order_by(Alert.created_at.desc())
        )
        if existing:
            deduplicated_alert = Alert(
                organization_id=key.organization_id,
                service_id=service.id,
                incident_id=existing.id,
                source=payload.source,
                fingerprint=payload.fingerprint,
                title=payload.title,
                description=payload.description,
                severity=payload.severity,
                payload=payload.payload,
            )
            db.add(deduplicated_alert)
            db.add(IncidentEvent(
                incident_id=existing.id,
                actor_id=None,
                event_type="alert.deduplicated",
                message=f"Repeated alert received from {payload.source} and attached to the active incident.",
                event_metadata={
                    "actor": "api_key",
                    "api_key_prefix": key.key_prefix,
                    "fingerprint": payload.fingerprint,
                    "source": payload.source,
                },
            ))
            await db.flush()
            db.add(AuditEvent(
                organization_id=key.organization_id,
                actor_id=None,
                action="alert.deduplicated",
                resource_type="alert",
                resource_id=str(deduplicated_alert.id),
                details={
                    "incident_id": str(existing.id),
                    "service_id": str(service.id),
                    "source": payload.source,
                    "api_key_prefix": key.key_prefix,
                },
            ))
            await db.commit()
            await queue_webhook_event(
                db,
                key.organization_id,
                "alert.deduplicated",
                {
                    "alert_id": str(deduplicated_alert.id),
                    "incident_id": str(existing.id),
                    "service_id": str(service.id),
                    "service_slug": service.slug,
                    "title": payload.title,
                    "severity": payload.severity.value,
                    "source": payload.source,
                    "fingerprint": payload.fingerprint,
                },
            )
            await manager.broadcast(key.organization_id, {"type": "alert.deduplicated", "incident_id": str(existing.id)})
            return existing

    service.status = ServiceStatus.outage if payload.severity == "sev1" else ServiceStatus.degraded
    incident = Incident(
        organization_id=key.organization_id,
        service_id=service.id,
        created_by_id=None,
        commander_id=None,
        title=payload.title,
        summary=payload.description,
        severity=payload.severity,
    )
    db.add(incident)
    await db.flush()
    alert = Alert(
        organization_id=key.organization_id,
        service_id=service.id,
        incident_id=incident.id,
        source=payload.source,
        fingerprint=payload.fingerprint,
        title=payload.title,
        description=payload.description,
        severity=payload.severity,
        payload=payload.payload,
    )
    db.add(alert)
    await db.flush()
    db.add(IncidentEvent(
        incident_id=incident.id,
        actor_id=None,
        event_type="alert.triggered",
        message=f"Alert received from {payload.source}; incident created automatically.",
        event_metadata={
            "actor": "api_key",
            "api_key_prefix": key.key_prefix,
            "fingerprint": payload.fingerprint,
            "source": payload.source,
        },
    ))
    db.add(AuditEvent(
        organization_id=key.organization_id,
        actor_id=None,
        action="alert.ingested",
        resource_type="alert",
        resource_id=str(alert.id),
        details={
            "incident_id": str(incident.id),
            "service_id": str(service.id),
            "source": payload.source,
            "api_key_prefix": key.key_prefix,
        },
    ))
    await db.commit()
    await db.refresh(incident)
    enqueue_incident_notification(str(key.organization_id), str(incident.id), incident.title)
    await queue_webhook_event(
        db,
        key.organization_id,
        "alert.triggered",
        {
            "alert_id": str(alert.id),
            "incident_id": str(incident.id),
            "service_id": str(service.id),
            "service_slug": service.slug,
            "title": payload.title,
            "severity": payload.severity.value,
            "source": payload.source,
            "fingerprint": payload.fingerprint,
        },
    )
    await manager.broadcast(key.organization_id, {"type": "alert.triggered", "incident_id": str(incident.id)})
    return incident
