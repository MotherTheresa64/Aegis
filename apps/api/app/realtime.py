import uuid
from collections import defaultdict

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self) -> None:
        self.connections: dict[uuid.UUID, dict[WebSocket, uuid.UUID]] = defaultdict(dict)

    async def connect(
        self,
        organization_id: uuid.UUID,
        user_id: uuid.UUID,
        websocket: WebSocket,
    ) -> None:
        await websocket.accept()
        self.connections[organization_id][websocket] = user_id

    def disconnect(self, organization_id: uuid.UUID, websocket: WebSocket) -> None:
        organization_connections = self.connections.get(organization_id)
        if organization_connections is None:
            return
        organization_connections.pop(websocket, None)
        if not organization_connections:
            self.connections.pop(organization_id, None)

    async def disconnect_user(
        self,
        organization_id: uuid.UUID,
        user_id: uuid.UUID,
        code: int = 4403,
    ) -> None:
        organization_connections = self.connections.get(organization_id, {})
        matching = [
            websocket
            for websocket, connection_user_id in organization_connections.items()
            if connection_user_id == user_id
        ]
        for websocket in matching:
            try:
                await websocket.close(code=code)
            finally:
                self.disconnect(organization_id, websocket)

    async def broadcast(self, organization_id: uuid.UUID, payload: dict) -> None:
        stale: list[WebSocket] = []
        for connection in list(self.connections.get(organization_id, {})):
            try:
                await connection.send_json(payload)
            except Exception:
                stale.append(connection)
        for connection in stale:
            self.disconnect(organization_id, connection)


manager = ConnectionManager()
