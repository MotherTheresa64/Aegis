import asyncio
import logging
import uuid

import httpx
from celery import Celery

from .config import settings
from .db import SessionLocal
from .integration_models import DeliveryStatus, WebhookDelivery, WebhookEndpoint
from .integrations import assert_public_destination, decrypt_webhook_secret, signed_webhook_request

logger = logging.getLogger(__name__)

celery = Celery(
    "aegis",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
)
celery.conf.update(
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    task_reject_on_worker_lost=True,
    task_always_eager=settings.aegis_inline_jobs,
    task_store_eager_result=False,
)


@celery.task(bind=True, autoretry_for=(Exception,), retry_backoff=True, retry_kwargs={"max_retries": 5})
def dispatch_incident_notification(self, organization_id: str, incident_id: str, title: str) -> dict:
    logger.info(
        "incident_notification organization_id=%s incident_id=%s title=%s",
        organization_id,
        incident_id,
        title,
    )
    return {"status": "queued", "incident_id": incident_id}


def enqueue_incident_notification(organization_id: str, incident_id: str, title: str) -> bool:
    """Best-effort enqueue after the authoritative database transaction has committed."""
    try:
        dispatch_incident_notification.delay(organization_id, incident_id, title)
    except Exception:
        logger.exception(
            "incident_notification_enqueue_failed organization_id=%s incident_id=%s",
            organization_id,
            incident_id,
        )
        return False
    return True


def enqueue_webhook_delivery(delivery_id: str) -> bool:
    try:
        deliver_webhook.delay(delivery_id)
    except Exception:
        logger.exception("webhook_retry_enqueue_failed delivery_id=%s", delivery_id)
        return False
    return True


async def _deliver_webhook_once(delivery_id: uuid.UUID) -> str:
    async with SessionLocal() as db:
        delivery = await db.get(WebhookDelivery, delivery_id)
        if delivery is None:
            return "dead_letter"
        endpoint = await db.get(WebhookEndpoint, delivery.endpoint_id)
        if endpoint is None or not endpoint.enabled:
            delivery.status = DeliveryStatus.dead_letter
            delivery.last_error = "Webhook endpoint is missing or disabled"
            await db.commit()
            return "dead_letter"

        delivery.status = DeliveryStatus.delivering
        delivery.attempts += 1
        await db.commit()

        try:
            # Resolve immediately before the request and reject any private/reserved target.
            # Redirects are disabled below so a public endpoint cannot redirect the worker
            # into an internal address.
            await assert_public_destination(endpoint.url)
            secret = decrypt_webhook_secret(endpoint.signing_secret_encrypted)
            body, signature, timestamp = signed_webhook_request(secret, delivery.payload)
            timeout = httpx.Timeout(10.0, connect=5.0)
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
                response = await client.post(
                    endpoint.url,
                    content=body,
                    headers={
                        "Content-Type": "application/json",
                        "User-Agent": "Aegis-Webhooks/1.0",
                        "X-Aegis-Event": delivery.event_type,
                        "X-Aegis-Delivery": str(delivery.id),
                        "X-Aegis-Timestamp": timestamp,
                        "X-Aegis-Signature": signature,
                    },
                )
            delivery.response_status = response.status_code
            if 200 <= response.status_code < 300:
                delivery.status = DeliveryStatus.succeeded
                delivery.last_error = None
                await db.commit()
                return "succeeded"

            delivery.last_error = f"Endpoint returned HTTP {response.status_code}"
            # Retry only responses that are plausibly transient. Authentication errors,
            # malformed endpoints, and other permanent 4xx failures go straight to the
            # dead-letter state instead of consuming the entire retry budget.
            if response.status_code in {408, 425, 429} or response.status_code >= 500:
                delivery.status = DeliveryStatus.failed
                await db.commit()
                return "retry"

            delivery.status = DeliveryStatus.dead_letter
            await db.commit()
            return "dead_letter"
        except Exception as exc:
            delivery.status = DeliveryStatus.failed
            delivery.last_error = f"{type(exc).__name__}: {exc}"[:2000]
            await db.commit()
            logger.warning(
                "webhook_delivery_failed delivery_id=%s endpoint_id=%s error_type=%s",
                delivery.id,
                endpoint.id,
                type(exc).__name__,
            )
            return "retry"


async def _mark_dead_letter(delivery_id: uuid.UUID) -> None:
    async with SessionLocal() as db:
        delivery = await db.get(WebhookDelivery, delivery_id)
        if delivery is None:
            return
        delivery.status = DeliveryStatus.dead_letter
        if not delivery.last_error:
            delivery.last_error = "Delivery retry budget exhausted"
        await db.commit()


@celery.task(bind=True, max_retries=5)
def deliver_webhook(self, delivery_id: str) -> dict:
    parsed_id = uuid.UUID(delivery_id)
    result = asyncio.run(_deliver_webhook_once(parsed_id))
    if result in {"succeeded", "dead_letter"}:
        return {"status": result, "delivery_id": delivery_id}

    if self.request.retries >= 4:
        asyncio.run(_mark_dead_letter(parsed_id))
        return {"status": "dead_letter", "delivery_id": delivery_id}

    countdown = min(30 * (2 ** self.request.retries), 900)
    raise self.retry(countdown=countdown)
