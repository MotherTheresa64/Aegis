import uuid

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.integrations import signed_webhook_request, validate_webhook_url
from app.main import app


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def register(client: TestClient, prefix: str) -> tuple[str, str]:
    unique = uuid.uuid4().hex[:10]
    response = client.post(
        "/api/v1/auth/register",
        json={
            "email": f"{prefix}-{unique}@example.com",
            "full_name": f"{prefix.title()} Engineer",
            "password": "strong-test-password",
            "organization_name": f"{prefix.title()} {unique}",
        },
    )
    assert response.status_code == 201, response.text
    token = response.json()["access_token"]
    memberships = client.get("/api/v1/auth/memberships", headers=auth_headers(token))
    assert memberships.status_code == 200, memberships.text
    return token, memberships.json()[0]["organization"]["id"]


def create_service(client: TestClient, token: str, organization_id: str, name: str) -> dict:
    response = client.post(
        f"/api/v1/organizations/{organization_id}/services",
        headers=auth_headers(token),
        json={"name": name, "description": "Hardening test service"},
    )
    assert response.status_code == 201, response.text
    return response.json()


def create_incident(
    client: TestClient,
    token: str,
    organization_id: str,
    service_id: str,
    title: str,
) -> dict:
    response = client.post(
        f"/api/v1/organizations/{organization_id}/incidents",
        headers=auth_headers(token),
        json={
            "title": title,
            "summary": "Reliability regression test",
            "severity": "sev2",
            "service_id": service_id,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_api_key_revocation_system_attribution_and_dedup_scope(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.routers.developer.enqueue_incident_notification",
        lambda *args, **kwargs: True,
    )

    with TestClient(app) as client:
        alpha_token, alpha_org = register(client, "alpha-key")
        beta_token, _ = register(client, "beta-key")
        service_a = create_service(client, alpha_token, alpha_org, "Checkout API")
        service_b = create_service(client, alpha_token, alpha_org, "Ledger API")

        created_key = client.post(
            f"/api/v1/organizations/{alpha_org}/api-keys",
            headers=auth_headers(alpha_token),
            json={"name": "monitoring-ingest"},
        )
        assert created_key.status_code == 201, created_key.text
        key_body = created_key.json()
        raw_key = key_body["key"]
        api_key_id = key_body["id"]
        assert raw_key.startswith("aeg_live_")
        assert raw_key not in str(
            client.get(
                f"/api/v1/organizations/{alpha_org}/api-keys",
                headers=auth_headers(alpha_token),
            ).json()
        )

        cross_tenant_revoke = client.delete(
            f"/api/v1/organizations/{alpha_org}/api-keys/{api_key_id}",
            headers=auth_headers(beta_token),
        )
        assert cross_tenant_revoke.status_code == 403

        payload = {
            "service_slug": service_a["slug"],
            "title": "Checkout error rate elevated",
            "description": "Synthetic external alert",
            "severity": "sev1",
            "fingerprint": "checkout-errors",
            "source": "prometheus",
            "payload": {"value": 42},
        }
        first = client.post(
            "/api/v1/alerts/ingest",
            headers={"X-Aegis-Key": raw_key},
            json=payload,
        )
        assert first.status_code == 202, first.text
        first_body = first.json()
        assert first_body["created_by_id"] is None
        assert first_body["commander_id"] is None

        duplicate = client.post(
            "/api/v1/alerts/ingest",
            headers={"X-Aegis-Key": raw_key},
            json=payload,
        )
        assert duplicate.status_code == 202, duplicate.text
        assert duplicate.json()["id"] == first_body["id"]

        other_service_payload = {**payload, "service_slug": service_b["slug"]}
        other_service = client.post(
            "/api/v1/alerts/ingest",
            headers={"X-Aegis-Key": raw_key},
            json=other_service_payload,
        )
        assert other_service.status_code == 202, other_service.text
        assert other_service.json()["id"] != first_body["id"]

        revoked = client.delete(
            f"/api/v1/organizations/{alpha_org}/api-keys/{api_key_id}",
            headers=auth_headers(alpha_token),
        )
        assert revoked.status_code == 204, revoked.text

        rejected = client.post(
            "/api/v1/alerts/ingest",
            headers={"X-Aegis-Key": raw_key},
            json=payload,
        )
        assert rejected.status_code == 401


def test_incident_resolution_preserves_service_health_until_all_incidents_close(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.routers.incidents.enqueue_incident_notification",
        lambda *args, **kwargs: True,
    )

    with TestClient(app) as client:
        token, organization_id = register(client, "incident-state")
        service = create_service(client, token, organization_id, "Orders API")
        first = create_incident(
            client,
            token,
            organization_id,
            service["id"],
            "Orders API latency",
        )
        second = create_incident(
            client,
            token,
            organization_id,
            service["id"],
            "Orders API saturation",
        )

        resolved_first = client.patch(
            f"/api/v1/organizations/{organization_id}/incidents/{first['id']}/status",
            headers=auth_headers(token),
            json={"status": "resolved", "message": "Latency recovered"},
        )
        assert resolved_first.status_code == 200, resolved_first.text

        overview = client.get(
            f"/api/v1/organizations/{organization_id}/overview",
            headers=auth_headers(token),
        )
        assert overview.status_code == 200, overview.text
        service_state = next(item for item in overview.json()["services"] if item["id"] == service["id"])
        assert service_state["status"] != "operational"

        resolved_second = client.patch(
            f"/api/v1/organizations/{organization_id}/incidents/{second['id']}/status",
            headers=auth_headers(token),
            json={"status": "resolved", "message": "Capacity restored"},
        )
        assert resolved_second.status_code == 200, resolved_second.text

        overview = client.get(
            f"/api/v1/organizations/{organization_id}/overview",
            headers=auth_headers(token),
        )
        service_state = next(item for item in overview.json()["services"] if item["id"] == service["id"])
        assert service_state["status"] == "operational"

        reopen = client.patch(
            f"/api/v1/organizations/{organization_id}/incidents/{first['id']}/status",
            headers=auth_headers(token),
            json={"status": "monitoring"},
        )
        assert reopen.status_code == 409


def test_committed_incident_survives_notification_broker_failure(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.routers.incidents.enqueue_incident_notification",
        lambda *args, **kwargs: False,
    )

    with TestClient(app) as client:
        token, organization_id = register(client, "broker-failure")
        service = create_service(client, token, organization_id, "Search API")
        incident = create_incident(
            client,
            token,
            organization_id,
            service["id"],
            "Search API unavailable",
        )
        detail = client.get(
            f"/api/v1/organizations/{organization_id}/incidents/{incident['id']}",
            headers=auth_headers(token),
        )
        assert detail.status_code == 200
        assert detail.json()["id"] == incident["id"]


def test_whitespace_only_identity_fields_are_rejected() -> None:
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/auth/register",
            json={
                "email": f"blank-{uuid.uuid4().hex[:8]}@example.com",
                "full_name": "   ",
                "password": "strong-test-password",
                "organization_name": "Valid Org",
            },
        )
        assert response.status_code == 422


def test_webhook_urls_reject_internal_targets_and_signatures_bind_timestamp() -> None:
    for unsafe_url in (
        "http://example.com/hook",
        "https://127.0.0.1/hook",
        "https://10.0.0.5/hook",
        "https://user:password@example.com/hook",
    ):
        with pytest.raises(HTTPException):
            validate_webhook_url(unsafe_url)

    body, signature, timestamp = signed_webhook_request(
        "whsec_test-secret",
        {"type": "incident.created", "data": {"id": "123"}},
        timestamp=1_700_000_000,
    )
    assert body
    assert timestamp == "1700000000"
    assert signature.startswith("sha256=")

    _, changed_signature, _ = signed_webhook_request(
        "whsec_test-secret",
        {"type": "incident.created", "data": {"id": "123"}},
        timestamp=1_700_000_001,
    )
    assert changed_signature != signature
