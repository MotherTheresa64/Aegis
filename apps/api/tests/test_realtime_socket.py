import uuid

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import app
from tests.test_hardening import auth_headers, register


def ticket(client: TestClient, token: str, organization_id: str) -> str:
    response = client.post(f"/api/v1/organizations/{organization_id}/realtime-ticket", headers=auth_headers(token))
    assert response.status_code == 200, response.text
    return response.json()["ticket"]


def closed_code(client: TestClient, path: str) -> int:
    with pytest.raises(WebSocketDisconnect) as closed:
        with client.websocket_connect(path) as socket:
            socket.receive_json()
    return closed.value.code


def test_socket_tickets_are_single_use_org_scoped_and_membership_is_enforced() -> None:
    with TestClient(app) as client:
        owner_token, owner_org = register(client, "rt-owner")
        member_token, member_org = register(client, "rt-member")
        member_email = client.get("/api/v1/auth/me", headers=auth_headers(member_token)).json()["email"]
        member_id = client.get("/api/v1/auth/me", headers=auth_headers(member_token)).json()["id"]

        # Missing, foreign-org and replayed tickets are refused at the handshake.
        assert closed_code(client, f"/ws/organizations/{owner_org}") == 4401
        foreign = ticket(client, member_token, member_org)
        assert closed_code(client, f"/ws/organizations/{owner_org}?ticket={foreign}") == 4401
        assert closed_code(client, f"/ws/organizations/{member_org}?ticket={foreign}") == 4401
        assert client.post(
            f"/api/v1/organizations/{owner_org}/realtime-ticket", headers=auth_headers(member_token)
        ).status_code == 403

        invite = client.post(
            f"/api/v1/organizations/{owner_org}/invitations",
            headers=auth_headers(owner_token),
            json={"email": member_email, "role": "viewer"},
        )
        assert invite.status_code == 201, invite.text
        accepted = client.post(f"/api/v1/invitations/{invite.json()['token']}/accept", headers=auth_headers(member_token))
        assert accepted.status_code == 200, accepted.text

        live = ticket(client, member_token, owner_org)
        with pytest.raises(WebSocketDisconnect) as removed:
            with client.websocket_connect(f"/ws/organizations/{owner_org}?ticket={live}") as socket:
                assert socket.receive_json()["type"] == "connected"
                response = client.delete(
                    f"/api/v1/organizations/{owner_org}/members/{uuid.UUID(member_id)}",
                    headers=auth_headers(owner_token),
                )
                assert response.status_code == 204, response.text
                socket.receive_json()
        assert removed.value.code == 4403
