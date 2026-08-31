import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import get_current_user, require_role
from ..models import Alert, ApiKey, Incident, IncidentEvent, IncidentStatus, Role, Service, ServiceStatus, User
from ..realtime import manager
from ..schemas import AlertIngest, ApiKeyCreate, ApiKeyCreated, ApiKeySummary, IncidentOut
from ..security import hash_api_key, issue_api_key
from ..worker import dispatch_incident_notification

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
    key = ApiKey(organization_id=organization_id, name=payload.name.strip(), key_prefix=prefix, key_hash=digest)
    db.add(key)
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
                Alert.fingerprint == payload.fingerprint,
                Incident.status != IncidentStatus.resolved,
            )
            .order_by(Alert.created_at.desc())
        )
        if existing:
            db.add(Alert(
                organization_id=key.organization_id,
                service_id=service.id,
                incident_id=existing.id,
                source=payload.source,
                fingerprint=payload.fingerprint,
                title=payload.title,
                description=payload.description,
                severity=payload.severity,
                payload=payload.payload,
            ))
            db.add(IncidentEvent(
                incident_id=existing.id,
                event_type="alert.deduplicated",
                message=f"Repeated alert received from {payload.source} and attached to the active incident.",
                event_metadata={"fingerprint": payload.fingerprint},
            ))
            await db.commit()
            await manager.broadcast(key.organization_id, {"type": "alert.deduplicated", "incident_id": str(existing.id)})
            return existing

    service.status = ServiceStatus.outage if payload.severity.value == "sev1" else ServiceStatus.degraded
    incident = Incident(
        organization_id=key.organization_id,
        service_id=service.id,
        created_by_id=await _first_member_id(db, key.organization_id),
        title=payload.title,
        summary=payload.description,
        severity=payload.severity,
    )
    db.add(incident)
    await db.flush()
    db.add(Alert(
        organization_id=key.organization_id,
        service_id=service.id,
        incident_id=incident.id,
        source=payload.source,
        fingerprint=payload.fingerprint,
        title=payload.title,
        description=payload.description,
        severity=payload.severity,
        payload=payload.payload,
    ))
    db.add(IncidentEvent(
        incident_id=incident.id,
        event_type="alert.triggered",
        message=f"Alert received from {payload.source}; incident created automatically.",
        event_metadata={"fingerprint": payload.fingerprint, "source": payload.source},
    ))
    await db.commit()
    await db.refresh(incident)
    dispatch_incident_notification.delay(str(key.organization_id), str(incident.id), incident.title)
    await manager.broadcast(key.organization_id, {"type": "alert.triggered", "incident_id": str(incident.id)})
    return incident


async def _first_member_id(db: AsyncSession, organization_id: uuid.UUID) -> uuid.UUID:
    from ..models import OrganizationMember

    member_id = await db.scalar(
        select(OrganizationMember.user_id)
        .where(OrganizationMember.organization_id == organization_id)
        .order_by(OrganizationMember.created_at.asc())
    )
    if member_id is None:
        raise HTTPException(status_code=409, detail="Organization has no members")
    return member_id
