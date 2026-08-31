import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from redis.asyncio import from_url
from sqlalchemy import select, text

from .config import settings
from .db import SessionLocal
from .migrations import run_migrations
from .models import OrganizationMember, User
from .observability import observe_request
from .ratelimit import rate_limit_request
from .realtime import manager
from .realtime_auth import consume_realtime_ticket
from .routers import (
    alerts,
    analytics,
    auth,
    collaboration,
    dependencies,
    developer,
    incidents,
    organizations,
    postmortems,
    realtime,
    services,
    status,
    tasks,
    webhooks,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("aegis")


@asynccontextmanager
async def lifespan(_: FastAPI):
    await run_migrations()
    logger.info("aegis_started env=%s", settings.aegis_env)
    yield


app = FastAPI(
    title="Aegis API",
    version="0.3.0",
    description="Real-time incident operations platform",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.aegis_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for router in (
    auth.router,
    collaboration.router,
    organizations.router,
    services.router,
    incidents.router,
    tasks.router,
    alerts.router,
    dependencies.router,
    analytics.router,
    developer.router,
    webhooks.router,
    postmortems.router,
    status.router,
    realtime.router,
):
    app.include_router(router, prefix="/api/v1")


@app.middleware("http")
async def request_context(request, call_next):
    request_id = request.headers.get("x-request-id", str(uuid.uuid4()))
    started = time.perf_counter()

    decision = await rate_limit_request(request)
    if decision.allowed:
        response = await call_next(request)
    else:
        response = JSONResponse(
            status_code=429,
            content={"detail": "Rate limit exceeded"},
            headers={"Retry-After": str(decision.retry_after)},
        )

    duration_seconds = time.perf_counter() - started
    duration_ms = round(duration_seconds * 1000, 2)
    route_object = request.scope.get("route")
    route = getattr(route_object, "path", request.url.path)
    observe_request(request.method, route, response.status_code, duration_seconds)

    response.headers["x-request-id"] = request_id
    response.headers["x-content-type-options"] = "nosniff"
    response.headers["x-frame-options"] = "DENY"
    response.headers["referrer-policy"] = "no-referrer"
    response.headers["permissions-policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["content-security-policy"] = "default-src 'none'; frame-ancestors 'none'"
    if settings.aegis_env.lower() == "production":
        response.headers["strict-transport-security"] = "max-age=31536000; includeSubDomains"

    logger.info(
        "request id=%s method=%s path=%s status=%s duration_ms=%s",
        request_id,
        request.method,
        request.url.path,
        response.status_code,
        duration_ms,
    )
    return response


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": "aegis-api", "version": app.version}


@app.get("/ready")
async def ready() -> dict:
    async with SessionLocal() as db:
        await db.execute(text("SELECT 1"))

    redis = from_url(settings.redis_url, decode_responses=True)
    try:
        await redis.ping()
    finally:
        await redis.aclose()

    return {"status": "ready", "database": "ok", "redis": "ok"}


@app.get("/metrics", include_in_schema=False)
async def metrics() -> Response:
    return Response(content=generate_latest(), headers={"Content-Type": CONTENT_TYPE_LATEST})


@app.websocket("/ws/organizations/{organization_id}")
async def organization_socket(
    websocket: WebSocket,
    organization_id: uuid.UUID,
    ticket: str | None = None,
):
    if not ticket:
        await websocket.close(code=4401)
        return

    try:
        identity = await consume_realtime_ticket(ticket)
    except Exception:
        identity = None
    if identity is None or identity.organization_id != organization_id:
        await websocket.close(code=4401)
        return

    async with SessionLocal() as db:
        membership = await db.scalar(
            select(OrganizationMember).where(
                OrganizationMember.user_id == identity.user_id,
                OrganizationMember.organization_id == organization_id,
            )
        )
        user = await db.get(User, identity.user_id)
        if membership is None or user is None or not user.is_active:
            await websocket.close(code=4403)
            return
    await manager.connect(organization_id, websocket)
    await websocket.send_json({"type": "connected", "organization_id": str(organization_id)})
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(organization_id, websocket)
