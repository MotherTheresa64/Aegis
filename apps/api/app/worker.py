import asyncio
import logging
import uuid

import httpx
from celery import Celery

from .config import settings
from .db import SessionLocal
from .integration_models import DeliveryStatus, WebhookDelivery, WebhookEndpoint
from .integrations import assert_public_destination, decrypt_webhook_secret, signed_webhook_body

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
            await assert_public_destination(endpoint.url)
            secret = decrypt_webhook_secret(endpoint.signing_secret_encrypted)
            body, signature = signed_webhook_body(secret, delivery.payload)
            async with httpx.AsyncClient(timeout=10.0, follow_redirects=False) as client:
                response = await client.post(
                    endpoint.url,
                    content=body,
                    headers={
                        "Content-Type": "application/json",
                        "User-Agent": "Aegis-Webhooks/1.0",
                        "X-Aegis-Event": delivery.event_type,
                        "X-Aegis-Delivery": str(delivery.id),
                        "X-Aegis-Signature": signature,
                    },
                )
            delivery.response_status = response.status_code
            if 200 <= response.status_code < 300:
                delivery.status = DeliveryStatus.succeeded
                delivery.last_error = None
                await db.commit()
                return "succeeded"
            delivery.status = DeliveryStatus.failed
            delivery.last_error = f"Endpoint returned HTTP {response.status_code}"
            await db.commit()
            return "failed"
        except Exception as exc:
            delivery.status = DeliveryStatus.failed
            delivery.last_error = str(exc)[:2000]
            await db.commit()
            logger.warning(
                "webhook_delivery_failed delivery_id=%s endpoint_id=%s error=%s",
                delivery.id,
                endpoint.id,
                exc,
            )
            return "failed"


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
    if result == "succeeded":
        return {"status": result, "delivery_id": delivery_id}
    if result == "dead_letter":
        return {"status": result, "delivery_id": delivery_id}
    if self.request.retries >= 4:
        asyncio.run(_mark_dead_letter(parsed_id))
        return {"status": "dead_letter", "delivery_id": delivery_id}

    countdown = min(30 * (2 ** self.request.retries), 900)
    raise self.retry(countdown=countdown)
