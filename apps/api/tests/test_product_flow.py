from fastapi.testclient import TestClient

from app.main import app


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def register(client: TestClient, email: str, organization: str) -> tuple[str, str]:
    response = client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "full_name": "Test Engineer",
            "password": "strong-test-password",
            "organization_name": organization,
        },
    )
    assert response.status_code == 201, response.text
    token = response.json()["access_token"]
    memberships = client.get("/api/v1/auth/memberships", headers=auth_headers(token))
    assert memberships.status_code == 200
    return token, memberships.json()[0]["organization"]["id"]


def test_tenant_isolation_and_incident_lifecycle(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.routers.incidents.dispatch_incident_notification.delay",
        lambda *args, **kwargs: None,
    )

    with TestClient(app) as client:
        alpha_token, alpha_org = register(client, "alpha@example.com", "Alpha Systems")
        beta_token, _ = register(client, "beta@example.com", "Beta Systems")

        service = client.post(
            f"/api/v1/organizations/{alpha_org}/services",
            headers=auth_headers(alpha_token),
            json={"name": "Payments API", "description": "Production payment routing"},
        )
        assert service.status_code == 201, service.text
        service_id = service.json()["id"]

        forbidden = client.get(
            f"/api/v1/organizations/{alpha_org}/services",
            headers=auth_headers(beta_token),
        )
        assert forbidden.status_code == 403

        incident = client.post(
            f"/api/v1/organizations/{alpha_org}/incidents",
            headers=auth_headers(alpha_token),
            json={
                "title": "Payment authorization failures",
                "summary": "Authorization error rate exceeded threshold.",
                "severity": "sev1",
                "service_id": service_id,
            },
        )
        assert incident.status_code == 201, incident.text
        incident_id = incident.json()["id"]

        detail = client.get(
            f"/api/v1/organizations/{alpha_org}/incidents/{incident_id}",
            headers=auth_headers(alpha_token),
        )
        assert detail.status_code == 200, detail.text
        assert detail.json()["events"][0]["event_type"] == "incident.created"

        resolved = client.patch(
            f"/api/v1/organizations/{alpha_org}/incidents/{incident_id}/status",
            headers=auth_headers(alpha_token),
            json={"status": "resolved", "message": "Rollback restored authorization traffic."},
        )
        assert resolved.status_code == 200, resolved.text
        assert resolved.json()["status"] == "resolved"

        overview = client.get(
            f"/api/v1/organizations/{alpha_org}/overview",
            headers=auth_headers(alpha_token),
        )
        assert overview.status_code == 200
        assert overview.json()["active_incidents"] == 0
        assert overview.json()["services_impacted"] == 0
