import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import logging
import uuid

import httpx
from celery import Celery
from sqlalchemy import select, update

from .config import settings
from .db import SessionLocal, engine
from .integration_models import DeliveryStatus, WebhookDelivery, WebhookEndpoint
from .integrations import assert_public_destination, decrypt_webhook_secret, pinned_request, signed_webhook_request

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
    # Nothing reads task results; skipping the result backend also keeps publish off Redis pub/sub.
    task_ignore_result=True,
    # Publishing happens inside request handlers after commit. With Celery defaults an
    # unreachable broker blocks the request for ~100s; fail fast and leave the durable
    # delivery row in `failed` for retry instead.
    broker_connection_timeout=2,
    broker_transport_options={"socket_connect_timeout": 2, "socket_timeout": 2},
    task_publish_retry_policy={"max_retries": 1, "interval_start": 0, "interval_step": 0.2, "interval_max": 0.2},
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
        # Claim atomically: a duplicate task (double-clicked retry, broker redelivery,
        # recovery sweep) finds the row no longer pending/failed and sends nothing.
        claimed = await db.execute(
            update(WebhookDelivery)
            .where(
                WebhookDelivery.id == delivery_id,
                WebhookDelivery.status.in_([DeliveryStatus.pending, DeliveryStatus.failed]),
            )
            .values(status=DeliveryStatus.delivering, attempts=WebhookDelivery.attempts + 1)
        )
        await db.commit()
        if claimed.rowcount != 1:
            return "skipped"
        delivery = await db.get(WebhookDelivery, delivery_id)
        if delivery is None:
            return "dead_letter"
        endpoint = await db.get(WebhookEndpoint, delivery.endpoint_id)
        if endpoint is None or not endpoint.enabled:
            delivery.status = DeliveryStatus.dead_letter
            delivery.last_error = "Webhook endpoint is missing or disabled"
            await db.commit()
            return "dead_letter"

        try:
            # Resolve immediately before the request and reject any private/reserved target.
            # Redirects are disabled below so a public endpoint cannot redirect the worker
            # into an internal address.
            address = await assert_public_destination(endpoint.url)
            target_url, host_header, extensions = pinned_request(endpoint.url, address)
            secret = decrypt_webhook_secret(endpoint.signing_secret_encrypted)
            body, signature, timestamp = signed_webhook_request(secret, delivery.payload)
            timeout = httpx.Timeout(10.0, connect=5.0)
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
                response = await client.post(
                    target_url,
                    content=body,
                    extensions=extensions,
                    headers={
                        **host_header,
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


def _run(coroutine) -> object:
    """Run a coroutine to completion from a synchronous Celery task.

    Each call gets a fresh event loop, and pooled asyncpg connections are bound to the loop
    that opened them, so the pool is released before that loop closes. Some Celery/Python
    combinations execute tasks with an event loop already running in the worker thread,
    where asyncio.run() refuses to start, so fall back to a short-lived thread.
    """

    async def runner():
        try:
            return await coroutine
        finally:
            await engine.dispose()

    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(runner())
    with ThreadPoolExecutor(max_workers=1) as executor:
        return executor.submit(asyncio.run, runner()).result()


@celery.task(bind=True, max_retries=5)
def deliver_webhook(self, delivery_id: str) -> dict:
    parsed_id = uuid.UUID(delivery_id)
    result = _run(_deliver_webhook_once(parsed_id))
    if result in {"succeeded", "dead_letter", "skipped"}:
        return {"status": result, "delivery_id": delivery_id}

    if self.request.retries >= 4:
        _run(_mark_dead_letter(parsed_id))
        return {"status": "dead_letter", "delivery_id": delivery_id}

    countdown = min(30 * (2 ** self.request.retries), 900)
    raise self.retry(countdown=countdown)


# A delivery untouched this long has lost its task: the API crashed between commit and
# publish, the broker refused the publish, or the worker died mid-send. The longest
# legitimate wait is the last Celery retry countdown (240 s).
STALE_DELIVERY_AFTER = timedelta(minutes=10)
MAX_DELIVERY_ATTEMPTS = 10
RECOVERY_INTERVAL_SECONDS = 60


async def recover_stale_deliveries(now: datetime | None = None, limit: int = 100) -> list[uuid.UUID]:
    """Re-enqueue deliveries whose task was lost; dead-letter ones past the attempt cap.

    Each row is claimed with a conditional UPDATE, so several API replicas sweeping at
    once never enqueue the same delivery twice.
    """
    cutoff = (now or datetime.now(timezone.utc)) - STALE_DELIVERY_AFTER
    stale_statuses = [DeliveryStatus.pending, DeliveryStatus.failed, DeliveryStatus.delivering]
    recovered: list[uuid.UUID] = []
    async with SessionLocal() as db:
        rows = (
            await db.execute(
                select(WebhookDelivery.id, WebhookDelivery.attempts)
                .where(WebhookDelivery.status.in_(stale_statuses), WebhookDelivery.updated_at < cutoff)
                .order_by(WebhookDelivery.updated_at)
                .limit(limit)
            )
        ).all()
        for delivery_id, attempts in rows:
            exhausted = attempts >= MAX_DELIVERY_ATTEMPTS
            values = (
                {"status": DeliveryStatus.dead_letter, "last_error": "Delivery recovery budget exhausted"}
                if exhausted
                else {"status": DeliveryStatus.pending}
            )
            claimed = await db.execute(
                update(WebhookDelivery)
                .where(
                    WebhookDelivery.id == delivery_id,
                    WebhookDelivery.status.in_(stale_statuses),
                    WebhookDelivery.updated_at < cutoff,
                )
                .values(**values)
            )
            if claimed.rowcount == 1 and not exhausted:
                recovered.append(delivery_id)
        await db.commit()
    for delivery_id in recovered:
        enqueue_webhook_delivery(str(delivery_id))
    if recovered:
        logger.warning("webhook_deliveries_recovered count=%s", len(recovered))
    return recovered


async def run_delivery_recovery_loop() -> None:
    while True:
        await asyncio.sleep(RECOVERY_INTERVAL_SECONDS)
        try:
            await recover_stale_deliveries()
        except Exception:
            logger.exception("webhook_delivery_recovery_failed")
