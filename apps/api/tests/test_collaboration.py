from fastapi.testclient import TestClient

from app.main import app


def headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def register(client: TestClient, email: str, organization: str) -> tuple[str, str]:
    response = client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "full_name": email.split("@")[0].title(),
            "password": "collaboration-test-password",
            "organization_name": organization,
        },
    )
    assert response.status_code == 201, response.text
    token = response.json()["access_token"]
    memberships = client.get("/api/v1/auth/memberships", headers=headers(token)).json()
    return token, memberships[0]["organization"]["id"]


def test_invitation_acceptance_and_tenant_access() -> None:
    with TestClient(app) as client:
        owner_token, owner_org = register(client, "collab-owner@example.com", "Collab Primary")
        invited_token, _ = register(client, "collab-invitee@example.com", "Invitee Personal")

        invitation = client.post(
            f"/api/v1/organizations/{owner_org}/invitations",
            headers=headers(owner_token),
            json={"email": "collab-invitee@example.com", "role": "responder"},
        )
        assert invitation.status_code == 201, invitation.text
        invite_token = invitation.json()["token"]
        assert invite_token.startswith("aeg_inv_")

        preview = client.get(f"/api/v1/invitations/{invite_token}")
        assert preview.status_code == 200
        assert preview.json()["organization_name"] == "Collab Primary"
        assert preview.json()["role"] == "responder"

        accepted = client.post(
            f"/api/v1/invitations/{invite_token}/accept",
            headers=headers(invited_token),
        )
        assert accepted.status_code == 200, accepted.text
        assert accepted.json()["role"] == "responder"

        members = client.get(
            f"/api/v1/organizations/{owner_org}/members",
            headers=headers(owner_token),
        )
        assert members.status_code == 200
        assert len(members.json()) == 2

        invited_memberships = client.get(
            "/api/v1/auth/memberships",
            headers=headers(invited_token),
        )
        assert invited_memberships.status_code == 200
        assert any(
            item["organization"]["id"] == owner_org and item["role"] == "responder"
            for item in invited_memberships.json()
        )

        duplicate_accept = client.post(
            f"/api/v1/invitations/{invite_token}/accept",
            headers=headers(invited_token),
        )
        assert duplicate_accept.status_code == 409


def test_invitation_email_binding() -> None:
    with TestClient(app) as client:
        owner_token, owner_org = register(client, "bound-owner@example.com", "Bound Primary")
        wrong_token, _ = register(client, "wrong-invitee@example.com", "Wrong Personal")

        invitation = client.post(
            f"/api/v1/organizations/{owner_org}/invitations",
            headers=headers(owner_token),
            json={"email": "intended-invitee@example.com", "role": "engineer"},
        )
        invite_token = invitation.json()["token"]

        response = client.post(
            f"/api/v1/invitations/{invite_token}/accept",
            headers=headers(wrong_token),
        )
        assert response.status_code == 403
