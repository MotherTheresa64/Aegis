import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import get_current_user, membership_for, require_role
from ..integrations import enqueue_webhook_deliveries, stage_webhook_event
from ..models import AuditEvent, Role, Service, User
from ..realtime import manager
from ..schemas import ServiceCreate, ServiceOut, ServiceStatusUpdate

router = APIRouter(prefix="/organizations/{organization_id}/services", tags=["services"])


def slugify(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-") or uuid.uuid4().hex[:8]


@router.get("", response_model=list[ServiceOut])
async def list_services(
    organization_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[Service]:
    await membership_for(db, user.id, organization_id)
    result = await db.execute(
        select(Service).where(Service.organization_id == organization_id).order_by(Service.name)
    )
    return list(result.scalars())


@router.post("", response_model=ServiceOut, status_code=status.HTTP_201_CREATED)
async def create_service(
    organization_id: uuid.UUID,
    payload: ServiceCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Service:
    await require_role(db, user.id, organization_id, {Role.owner, Role.admin, Role.engineer})
    service = Service(
        organization_id=organization_id,
        name=payload.name,
        slug=f"{slugify(payload.name)}-{uuid.uuid4().hex[:4]}",
        description=payload.description,
    )
    db.add(service)
    await db.flush()
    db.add(AuditEvent(
        organization_id=organization_id,
        actor_id=user.id,
        action="service.created",
        resource_type="service",
        resource_id=str(service.id),
        details={"name": service.name},
    ))
    await db.commit()
    await db.refresh(service)
    await manager.broadcast(organization_id, {"type": "service.created", "service_id": str(service.id)})
    return service


@router.patch("/{service_id}/status", response_model=ServiceOut)
async def update_service_status(
    organization_id: uuid.UUID,
    service_id: uuid.UUID,
    payload: ServiceStatusUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Service:
    await require_role(db, user.id, organization_id, {Role.owner, Role.admin, Role.engineer, Role.responder})
    service = await db.get(Service, service_id)
    if service is None or service.organization_id != organization_id:
        raise HTTPException(status_code=404, detail="Service not found")
    if service.status == payload.status:
        raise HTTPException(status_code=409, detail="Service is already in that status")

    previous = service.status.value
    service.status = payload.status
    db.add(AuditEvent(
        organization_id=organization_id,
        actor_id=user.id,
        action="service.status_changed",
        resource_type="service",
        resource_id=str(service.id),
        details={"from": previous, "to": service.status.value},
    ))
    deliveries = await stage_webhook_event(
        db,
        organization_id,
        "service.status_changed",
        {"service_id": str(service.id), "from": previous, "to": service.status.value},
    )
    await db.commit()
    await db.refresh(service)
    await enqueue_webhook_deliveries(db, deliveries)
    await manager.broadcast(organization_id, {"type": "service.updated", "service_id": str(service.id)})
    return service
