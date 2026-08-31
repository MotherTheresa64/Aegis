import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import get_current_user, require_role
from ..integration_models import DeliveryStatus, WebhookDelivery, WebhookEndpoint
from ..integrations import encrypt_webhook_secret, issue_webhook_secret, validate_webhook_url
from ..models import AuditEvent, Role, User
from ..worker import deliver_webhook

router = APIRouter(prefix="/organizations/{organization_id}/webhooks", tags=["webhooks"])

SUPPORTED_EVENTS = {
    "incident.created",
    "incident.updated",
    "incident.resolved",
    "incident.task_created",
    "incident.task_updated",
    "alert.triggered",
    "alert.deduplicated",
    "service.status_changed",
}


class WebhookCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    url: str = Field(min_length=8, max_length=2000)
    event_types: list[str] = Field(default_factory=list, max_length=20)


class WebhookOut(BaseModel):
    id: uuid.UUID
    name: str
    url: str
    event_types: list[str]
    enabled: bool
    created_at: datetime
    updated_at: datetime


class WebhookCreated(WebhookOut):
    signing_secret: str


class WebhookEnabledUpdate(BaseModel):
    enabled: bool


class DeliveryOut(BaseModel):
    id: uuid.UUID
    endpoint_id: uuid.UUID
    event_type: str
    status: DeliveryStatus
    attempts: int
    response_status: int | None
    last_error: str | None
    created_at: datetime
    updated_at: datetime


def _endpoint_out(endpoint: WebhookEndpoint) -> WebhookOut:
    return WebhookOut(
        id=endpoint.id,
        name=endpoint.name,
        url=endpoint.url,
        event_types=endpoint.event_types,
        enabled=endpoint.enabled,
        created_at=endpoint.created_at,
        updated_at=endpoint.updated_at,
    )


@router.get("", response_model=list[WebhookOut])
async def list_webhooks(
    organization_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[WebhookOut]:
    await require_role(db, user.id, organization_id, {Role.owner, Role.admin, Role.engineer})
    endpoints = list(
        (
            await db.scalars(
                select(WebhookEndpoint)
                .where(WebhookEndpoint.organization_id == organization_id)
                .order_by(WebhookEndpoint.created_at.desc())
            )
        ).all()
    )
    return [_endpoint_out(endpoint) for endpoint in endpoints]


@router.post("", response_model=WebhookCreated, status_code=status.HTTP_201_CREATED)
async def create_webhook(
    organization_id: uuid.UUID,
    payload: WebhookCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> WebhookCreated:
    await require_role(db, user.id, organization_id, {Role.owner, Role.admin})
    unsupported = sorted(set(payload.event_types) - SUPPORTED_EVENTS)
    if unsupported:
        raise HTTPException(status_code=422, detail=f"Unsupported webhook events: {', '.join(unsupported)}")
    url = validate_webhook_url(payload.url.strip())
    secret = issue_webhook_secret()
    endpoint = WebhookEndpoint(
        organization_id=organization_id,
        name=payload.name.strip(),
        url=url,
        signing_secret_encrypted=encrypt_webhook_secret(secret),
        event_types=sorted(set(payload.event_types)),
    )
    db.add(endpoint)
    await db.flush()
    db.add(
        AuditEvent(
            organization_id=organization_id,
            actor_id=user.id,
            action="webhook.created",
            resource_type="webhook",
            resource_id=str(endpoint.id),
            details={"name": endpoint.name, "url": endpoint.url},
        )
    )
    await db.commit()
    await db.refresh(endpoint)
    return WebhookCreated(**_endpoint_out(endpoint).model_dump(), signing_secret=secret)


@router.patch("/{endpoint_id}", response_model=WebhookOut)
async def set_webhook_enabled(
    organization_id: uuid.UUID,
    endpoint_id: uuid.UUID,
    payload: WebhookEnabledUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> WebhookOut:
    await require_role(db, user.id, organization_id, {Role.owner, Role.admin})
    endpoint = await db.scalar(
        select(WebhookEndpoint).where(
            WebhookEndpoint.id == endpoint_id,
            WebhookEndpoint.organization_id == organization_id,
        )
    )
    if endpoint is None:
        raise HTTPException(status_code=404, detail="Webhook endpoint not found")
    endpoint.enabled = payload.enabled
    await db.commit()
    await db.refresh(endpoint)
    return _endpoint_out(endpoint)


@router.get("/deliveries", response_model=list[DeliveryOut])
async def list_deliveries(
    organization_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[WebhookDelivery]:
    await require_role(db, user.id, organization_id, {Role.owner, Role.admin, Role.engineer})
    result = await db.execute(
        select(WebhookDelivery)
        .where(WebhookDelivery.organization_id == organization_id)
        .order_by(WebhookDelivery.created_at.desc())
        .limit(100)
    )
    return list(result.scalars())


@router.post("/deliveries/{delivery_id}/retry", response_model=DeliveryOut)
async def retry_delivery(
    organization_id: uuid.UUID,
    delivery_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> WebhookDelivery:
    await require_role(db, user.id, organization_id, {Role.owner, Role.admin, Role.engineer})
    delivery = await db.scalar(
        select(WebhookDelivery).where(
            WebhookDelivery.id == delivery_id,
            WebhookDelivery.organization_id == organization_id,
        )
    )
    if delivery is None:
        raise HTTPException(status_code=404, detail="Webhook delivery not found")
    delivery.status = DeliveryStatus.pending
    delivery.last_error = None
    await db.commit()
    await db.refresh(delivery)
    deliver_webhook.delay(str(delivery.id))
    return delivery
