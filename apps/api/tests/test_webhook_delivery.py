import asyncio
import socket
import uuid
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from fastapi.testclient import TestClient

from app import worker
from app.db import SessionLocal
from app.integration_models import DeliveryStatus, WebhookDelivery, WebhookEndpoint
from app.integrations import assert_public_destination, encrypt_webhook_secret, pinned_request
from app.main import app
from tests.test_hardening import register


def test_pinned_request_connects_to_validated_address_but_keeps_hostname() -> None:
    url, headers, extensions = pinned_request("https://hooks.example.com/path?q=1", "93.184.216.34")
    assert url == "https://93.184.216.34/path?q=1"
    assert headers == {"Host": "hooks.example.com"}
    assert extensions == {"sni_hostname": "hooks.example.com"}

    url, headers, _ = pinned_request("https://hooks.example.com:8443/x", "2606:2800:220:1::1")
    assert url == "https://[2606:2800:220:1::1]:8443/x"
    assert headers == {"Host": "hooks.example.com:8443"}


def test_destination_check_rejects_any_private_answer(monkeypatch) -> None:
    answers = [("93.184.216.34",), ("10.0.0.5",)]

    async def fake_getaddrinfo(self, host, port, type=0):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, port)) for (ip,) in answers]

    monkeypatch.setattr(asyncio.BaseEventLoop, "getaddrinfo", fake_getaddrinfo)
    with pytest.raises(ValueError):
        asyncio.run(assert_public_destination("https://rebind.example.com/hook"))
    answers.pop()
    assert asyncio.run(assert_public_destination("https://rebind.example.com/hook")) == "93.184.216.34"


def _organization_id() -> uuid.UUID:
    with TestClient(app) as client:
        _, organization_id = register(client, "webhook")
    return uuid.UUID(organization_id)


async def _create_delivery(organization_id: uuid.UUID, **fields) -> uuid.UUID:
    async with SessionLocal() as db:
        endpoint = WebhookEndpoint(
            organization_id=organization_id,
            name="Receiver",
            url="https://hooks.example.com/aegis",
            signing_secret_encrypted=encrypt_webhook_secret("whsec_test"),
            event_types=[],
        )
        db.add(endpoint)
        await db.flush()
        delivery = WebhookDelivery(
            organization_id=organization_id,
            endpoint_id=endpoint.id,
            event_type="incident.created",
            payload={"id": "evt", "type": "incident.created", "data": {}},
            **fields,
        )
        db.add(delivery)
        await db.commit()
        return delivery.id


async def _get_delivery(delivery_id: uuid.UUID) -> WebhookDelivery:
    async with SessionLocal() as db:
        return await db.get(WebhookDelivery, delivery_id)


def test_duplicate_delivery_tasks_send_once_over_the_pinned_address(monkeypatch) -> None:
    organization_id = _organization_id()
    delivery_id = worker._run(_create_delivery(organization_id))
    sent: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        return httpx.Response(204)

    async def public_address(url: str) -> str:
        return "93.184.216.34"

    real_client = httpx.AsyncClient
    monkeypatch.setattr(worker, "assert_public_destination", public_address)
    monkeypatch.setattr(
        worker.httpx,
        "AsyncClient",
        lambda **kwargs: real_client(transport=httpx.MockTransport(handler), **kwargs),
    )

    assert worker._run(worker._deliver_webhook_once(delivery_id)) == "succeeded"
    # A second task for the same delivery (broker redelivery, double retry) must not resend.
    assert worker._run(worker._deliver_webhook_once(delivery_id)) == "skipped"

    assert len(sent) == 1
    assert sent[0].url.host == "93.184.216.34"
    assert sent[0].headers["host"] == "hooks.example.com"
    assert sent[0].extensions["sni_hostname"] == "hooks.example.com"
    delivery = worker._run(_get_delivery(delivery_id))
    assert delivery.status == DeliveryStatus.succeeded
    assert delivery.attempts == 1


def test_recovery_requeues_lost_deliveries_once_and_caps_attempts(monkeypatch) -> None:
    organization_id = _organization_id()
    old = datetime.now(timezone.utc) - timedelta(hours=1)
    stuck = worker._run(_create_delivery(organization_id, status=DeliveryStatus.pending, updated_at=old))
    exhausted = worker._run(_create_delivery(
        organization_id, status=DeliveryStatus.failed, attempts=worker.MAX_DELIVERY_ATTEMPTS, updated_at=old,
    ))
    fresh = worker._run(_create_delivery(organization_id, status=DeliveryStatus.pending))

    enqueued: list[str] = []
    monkeypatch.setattr(worker, "enqueue_webhook_delivery", lambda delivery_id: enqueued.append(delivery_id) or True)

    recovered = worker._run(worker.recover_stale_deliveries())
    assert stuck in recovered
    assert exhausted not in recovered and fresh not in recovered
    assert str(stuck) in enqueued and str(fresh) not in enqueued
    assert worker._run(_get_delivery(exhausted)).status == DeliveryStatus.dead_letter

    # The claim bumps updated_at, so an immediate second sweep (another replica) skips it.
    assert stuck not in worker._run(worker.recover_stale_deliveries())
