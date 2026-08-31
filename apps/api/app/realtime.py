import uuid
from collections import defaultdict

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self) -> None:
        self.connections: dict[uuid.UUID, set[WebSocket]] = defaultdict(set)

    async def connect(self, organization_id: uuid.UUID, websocket: WebSocket) -> None:
        await websocket.accept()
        self.connections[organization_id].add(websocket)

    def disconnect(self, organization_id: uuid.UUID, websocket: WebSocket) -> None:
        self.connections[organization_id].discard(websocket)
        if not self.connections[organization_id]:
            self.connections.pop(organization_id, None)

    async def broadcast(self, organization_id: uuid.UUID, payload: dict) -> None:
        stale: list[WebSocket] = []
        for connection in list(self.connections.get(organization_id, set())):
            try:
                await connection.send_json(payload)
            except Exception:
                stale.append(connection)
        for connection in stale:
            self.disconnect(organization_id, connection)


manager = ConnectionManager()
