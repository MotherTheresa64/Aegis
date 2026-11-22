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


def test_public_status_exposes_only_public_fields(monkeypatch) -> None:
    monkeypatch.setattr("app.routers.incidents.enqueue_incident_notification", lambda *a, **k: True)
    with TestClient(app) as client:
        token, organization_id = register(client, "public")
        service = create_service(client, token, organization_id, "Edge API")
        incident = client.post(
            f"/api/v1/organizations/{organization_id}/incidents",
            headers=auth_headers(token),
            json={
                "service_id": service["id"],
                "title": "Elevated edge errors",
                "summary": "internal-only: db-primary-7 credentials rotated",
                "severity": "sev2",
            },
        )
        assert incident.status_code == 201, incident.text
        slug = client.get("/api/v1/auth/memberships", headers=auth_headers(token)).json()[0][
            "organization"
        ]["slug"]

        response = client.get(f"/api/v1/status/{slug}")

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["overall_status"] == "degraded"
        assert body["active_incidents"][0]["title"] == "Elevated edge errors"
        assert set(body["active_incidents"][0]) == {
            "id", "service_id", "title", "severity", "status", "created_at",
        }
        assert set(body["services"][0]) == {"id", "name", "description", "status"}
        assert "internal-only" not in response.text
        assert organization_id not in response.text


def test_dependency_delete_is_tenant_and_role_scoped() -> None:
    with TestClient(app) as client:
        token, organization_id = register(client, "deps")
        other_token, other_org = register(client, "intruder")
        source = create_service(client, token, organization_id, "Checkout")
        target = create_service(client, token, organization_id, "Payments")
        edge = client.post(
            f"/api/v1/organizations/{organization_id}/dependencies",
            headers=auth_headers(token),
            json={"source_service_id": source["id"], "target_service_id": target["id"]},
        )
        assert edge.status_code == 201, edge.text
        path = f"/api/v1/organizations/{organization_id}/dependencies/{edge.json()['id']}"

        # Another tenant can't delete it through either organization's route.
        assert client.delete(path, headers=auth_headers(other_token)).status_code == 403
        foreign = f"/api/v1/organizations/{other_org}/dependencies/{edge.json()['id']}"
        assert client.delete(foreign, headers=auth_headers(other_token)).status_code == 404

        assert client.delete(path, headers=auth_headers(token)).status_code == 204
        assert client.delete(path, headers=auth_headers(token)).status_code == 404
        remaining = client.get(
            f"/api/v1/organizations/{organization_id}/dependencies", headers=auth_headers(token)
        )
        assert remaining.json() == []
        audit = client.get(f"/api/v1/organizations/{organization_id}/audit", headers=auth_headers(token))
        assert any(item["action"] == "dependency.deleted" for item in audit.json())


def test_timestamps_are_serialized_with_utc_offset() -> None:
    with TestClient(app) as client:
        token, organization_id = register(client, "clock")
        service = create_service(client, token, organization_id, "Clock")
        listed = client.get(f"/api/v1/organizations/{organization_id}/services", headers=auth_headers(token))
        created_at = next(item for item in listed.json() if item["id"] == service["id"])["created_at"]
        assert created_at.endswith(("Z", "+00:00")), created_at


def test_public_status_hides_machine_generated_alert_titles() -> None:
    with TestClient(app) as client:
        token, organization_id = register(client, "alerts")
        service = create_service(client, token, organization_id, "Edge API")
        key = client.post(
            f"/api/v1/organizations/{organization_id}/api-keys",
            headers=auth_headers(token),
            json={"name": "Prometheus"},
        ).json()["key"]
        ingested = client.post(
            "/api/v1/alerts/ingest",
            headers={"X-Aegis-Key": key},
            json={
                "service_slug": service["slug"],
                "title": "db-primary-7.internal 10.0.4.12 refused",
                "severity": "sev2",
                "source": "prometheus",
            },
        )
        assert ingested.status_code == 202, ingested.text
        slug = client.get("/api/v1/auth/memberships", headers=auth_headers(token)).json()[0][
            "organization"
        ]["slug"]

        response = client.get(f"/api/v1/status/{slug}")

        assert "10.0.4.12" not in response.text
        assert response.json()["active_incidents"][0]["title"] == "Investigating an issue affecting Edge API"


def test_overview_keeps_old_unresolved_incidents(monkeypatch) -> None:
    monkeypatch.setattr("app.routers.incidents.enqueue_incident_notification", lambda *a, **k: True)
    with TestClient(app) as client:
        token, organization_id = register(client, "busy")
        base = f"/api/v1/organizations/{organization_id}/incidents"
        old = client.post(base, headers=auth_headers(token), json={"title": "Long-running SEV1", "severity": "sev1"})
        assert old.status_code == 201, old.text
        for index in range(21):
            created = client.post(base, headers=auth_headers(token), json={"title": f"Blip {index}"}).json()
            client.patch(f"{base}/{created['id']}/status", headers=auth_headers(token), json={"status": "resolved"})

        overview = client.get(f"/api/v1/organizations/{organization_id}/overview", headers=auth_headers(token)).json()

        assert overview["active_incidents"] == 1
        assert old.json()["id"] in {incident["id"] for incident in overview["incidents"]}
