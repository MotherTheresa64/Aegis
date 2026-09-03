import asyncio
import base64
import hashlib
import hmac
import ipaddress
import json
import logging
import secrets
import socket
import time
import uuid
from urllib.parse import urlparse

from cryptography.fernet import Fernet
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .integration_models import DeliveryStatus, WebhookDelivery, WebhookEndpoint

logger = logging.getLogger(__name__)


def _fernet() -> Fernet:
    key_material = hashlib.sha256(settings.aegis_secret_key.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key_material))


def issue_webhook_secret() -> str:
    return f"whsec_{secrets.token_urlsafe(32)}"


def encrypt_webhook_secret(secret: str) -> str:
    return _fernet().encrypt(secret.encode()).decode()


def decrypt_webhook_secret(encrypted: str) -> str:
    return _fernet().decrypt(encrypted.encode()).decode()


def validate_webhook_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme != "https":
        raise HTTPException(status_code=422, detail="Webhook URLs must use HTTPS")
    if not parsed.hostname:
        raise HTTPException(status_code=422, detail="Webhook URL must include a hostname")
    if parsed.username or parsed.password:
        raise HTTPException(status_code=422, detail="Webhook URLs cannot contain credentials")
    try:
        address = ipaddress.ip_address(parsed.hostname)
    except ValueError:
        return url
    if not address.is_global:
        raise HTTPException(status_code=422, detail="Webhook URL cannot target private or reserved networks")
    return url


async def assert_public_destination(url: str) -> None:
    parsed = urlparse(url)
    host = parsed.hostname
    if host is None:
        raise ValueError("Webhook hostname is missing")
    loop = asyncio.get_running_loop()
    addresses = await loop.getaddrinfo(host, parsed.port or 443, type=socket.SOCK_STREAM)
    if not addresses:
        raise ValueError("Webhook hostname could not be resolved")
    for address in addresses:
        ip = ipaddress.ip_address(address[4][0])
        if not ip.is_global:
            raise ValueError("Webhook destination resolved to a private or reserved address")


def signed_webhook_request(
    secret: str,
    payload: dict,
    timestamp: int | None = None,
) -> tuple[bytes, str, str]:
    """Sign timestamp + body so consumers can enforce a replay window."""
    body = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    timestamp_value = str(timestamp if timestamp is not None else int(time.time()))
    signed_payload = timestamp_value.encode() + b"." + body
    signature = hmac.new(secret.encode(), signed_payload, hashlib.sha256).hexdigest()
    return body, f"sha256={signature}", timestamp_value


async def stage_webhook_event(
    db: AsyncSession,
    organization_id: uuid.UUID,
    event_type: str,
    payload: dict,
) -> list[WebhookDelivery]:
    """Add durable delivery intents to the caller's current DB transaction.

    Domain state and webhook intent therefore commit atomically. Broker publication happens
    only after the caller commits, keeping Redis/Celery outside the database transaction.
    """
    endpoints = list(
        (
            await db.scalars(
                select(WebhookEndpoint).where(
                    WebhookEndpoint.organization_id == organization_id,
                    WebhookEndpoint.enabled.is_(True),
                )
            )
        ).all()
    )
    deliveries: list[WebhookDelivery] = []
    for endpoint in endpoints:
        if endpoint.event_types and event_type not in endpoint.event_types:
            continue
        delivery = WebhookDelivery(
            organization_id=organization_id,
            endpoint_id=endpoint.id,
            event_type=event_type,
            payload={
                "id": str(uuid.uuid4()),
                "type": event_type,
                "data": payload,
            },
        )
        db.add(delivery)
        deliveries.append(delivery)
    if deliveries:
        await db.flush()
    return deliveries


async def enqueue_webhook_deliveries(
    db: AsyncSession,
    deliveries: list[WebhookDelivery],
) -> list[uuid.UUID]:
    """Publish already-committed delivery rows without invalidating domain success.

    A broker failure changes the delivery to `failed` so the durable row remains visible and
    manually retryable. It never raises back through a request whose domain transaction has
    already committed.
    """
    if not deliveries:
        return []

    from .worker import deliver_webhook

    enqueue_failed = False
    for delivery in deliveries:
        try:
            deliver_webhook.delay(str(delivery.id))
        except Exception as exc:
            enqueue_failed = True
            delivery.status = DeliveryStatus.failed
            delivery.last_error = f"Task enqueue failed: {type(exc).__name__}"[:2000]
            logger.exception(
                "webhook_enqueue_failed delivery_id=%s endpoint_id=%s",
                delivery.id,
                delivery.endpoint_id,
            )
    if enqueue_failed:
        try:
            await db.commit()
        except Exception:
            await db.rollback()
            logger.exception("webhook_enqueue_failure_state_persist_failed")

    return [delivery.id for delivery in deliveries]
