import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, text

from .config import settings
from .db import SessionLocal, create_schema
from .models import OrganizationMember, User
from .realtime import manager
from .routers import alerts, analytics, auth, dependencies, developer, incidents, organizations, postmortems, services, status
from .security import decode_access_token

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("aegis")


@asynccontextmanager
async def lifespan(_: FastAPI):
    await create_schema()
    logger.info("aegis_started env=%s", settings.aegis_env)
    yield


app = FastAPI(title="Aegis API", version="0.2.0", description="Real-time incident operations platform", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.aegis_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for router in (
    auth.router,
    organizations.router,
    services.router,
    incidents.router,
    alerts.router,
    dependencies.router,
    analytics.router,
    developer.router,
    postmortems.router,
    status.router,
):
    app.include_router(router, prefix="/api/v1")


@app.middleware("http")
async def request_context(request, call_next):
    request_id = request.headers.get("x-request-id", str(uuid.uuid4()))
    started = time.perf_counter()
    response = await call_next(request)
    duration_ms = round((time.perf_counter() - started) * 1000, 2)
    response.headers["x-request-id"] = request_id
    logger.info("request id=%s method=%s path=%s status=%s duration_ms=%s", request_id, request.method, request.url.path, response.status_code, duration_ms)
    return response


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": "aegis-api", "version": app.version}


@app.get("/ready")
async def ready() -> dict:
    async with SessionLocal() as db:
        await db.execute(text("SELECT 1"))
    return {"status": "ready"}


@app.websocket("/ws/organizations/{organization_id}")
async def organization_socket(websocket: WebSocket, organization_id: uuid.UUID, token: str):
    try:
        user_id = decode_access_token(token)
    except Exception:
        await websocket.close(code=4401)
        return
    async with SessionLocal() as db:
        membership = await db.scalar(select(OrganizationMember).where(
            OrganizationMember.user_id == user_id,
            OrganizationMember.organization_id == organization_id,
        ))
        user = await db.get(User, user_id)
        if membership is None or user is None:
            await websocket.close(code=4403)
            return
    await manager.connect(organization_id, websocket)
    await websocket.send_json({"type": "connected", "organization_id": str(organization_id)})
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(organization_id, websocket)
