import asyncio

import httpx
import pytest
from fastapi.testclient import TestClient

from app.db import engine
from app.main import app
from tests.test_hardening import auth_headers, create_service, register

pytestmark = pytest.mark.skipif(
    engine.dialect.name != "postgresql",
    reason="the advisory-lock deduplication path only exists on PostgreSQL",
)


def test_concurrent_identical_alerts_open_exactly_one_incident() -> None:
    with TestClient(app) as client:
        token, organization_id = register(client, "concurrent")
        service = create_service(client, token, organization_id, "Ledger API")
        # Two keys, so the per-key row update cannot serialize the requests by itself.
        keys = [
            client.post(
                f"/api/v1/organizations/{organization_id}/api-keys",
                headers=auth_headers(token),
                json={"name": f"monitor-{index}"},
            ).json()["key"]
            for index in range(2)
        ]

    alert = {
        "service_slug": service["slug"],
        "title": "Ledger write latency above SLO",
        "severity": "sev2",
        "source": "prometheus",
        "fingerprint": "ledger:write-latency",
    }

    async def fire() -> list[httpx.Response]:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            return await asyncio.gather(*(
                client.post("/api/v1/alerts/ingest", json=alert, headers={"X-Aegis-Key": keys[index % 2]})
                for index in range(8)
            ))

    responses = asyncio.run(fire())
    assert all(response.status_code == 202 for response in responses), [r.text for r in responses]
    assert len({response.json()["id"] for response in responses}) == 1
