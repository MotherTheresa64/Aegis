import logging

from celery import Celery

from .config import settings

logger = logging.getLogger(__name__)

celery = Celery(
    "aegis",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
)
celery.conf.update(task_track_started=True, task_acks_late=True)


@celery.task(bind=True, autoretry_for=(Exception,), retry_backoff=True, retry_kwargs={"max_retries": 5})
def dispatch_incident_notification(self, organization_id: str, incident_id: str, title: str) -> dict:
    """Placeholder transport boundary for email/Slack/PagerDuty delivery.

    The worker and retry semantics are production-shaped now; provider-specific delivery is added
    without coupling request latency to third-party APIs.
    """
    logger.info(
        "incident_notification organization_id=%s incident_id=%s title=%s",
        organization_id,
        incident_id,
        title,
    )
    return {"status": "queued", "incident_id": incident_id}
