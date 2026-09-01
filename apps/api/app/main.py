import asyncio
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
    audit,
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
    logger.info("aegis_stopped")


app = FastAPI(
    title="Aegis API",
    version="0.4.0",
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
    audit.router,
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

    try:
        decision = await rate_limit_request(request)
        if decision.allowed:
            response = await call_next(request)
        else:
            response = JSONResponse(
                status_code=429,
                content={"detail": "Rate limit exceeded"},
                headers={"Retry-After": str(decision.retry_after)},
            )
    except Exception:
        logger.exception(
            "request_failed id=%s method=%s path=%s",
            request_id,
            request.method,
            request.url.path,
        )
        response = JSONResponse(
            status_code=500,
            content={"detail": "Internal server error", "request_id": request_id},
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
    response.headers["content-security-policy"] = "frame-ancestors 'none'"
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


@app.get("/ready", response_model=None)
async def ready() -> Response | dict:
    failures: dict[str, str] = {}
    try:
        async with SessionLocal() as db:
            await db.execute(text("SELECT 1"))
    except Exception as exc:
        failures["database"] = type(exc).__name__
        logger.warning("readiness_database_failed error_type=%s", type(exc).__name__)

    redis = from_url(settings.redis_url, decode_responses=True)
    try:
        await redis.ping()
    except Exception as exc:
        failures["redis"] = type(exc).__name__
        logger.warning("readiness_redis_failed error_type=%s", type(exc).__name__)
    finally:
        await redis.aclose()

    if failures:
        return JSONResponse(
            status_code=503,
            content={"status": "not_ready", "dependencies": failures},
        )
    return {"status": "ready", "database": "ok", "redis": "ok"}


@app.get("/metrics", include_in_schema=False)
async def metrics() -> Response:
    return Response(content=generate_latest(), headers={"Content-Type": CONTENT_TYPE_LATEST})


async def _realtime_access_valid(user_id: uuid.UUID, organization_id: uuid.UUID) -> bool:
    async with SessionLocal() as db:
        membership = await db.scalar(
            select(OrganizationMember).where(
                OrganizationMember.user_id == user_id,
                OrganizationMember.organization_id == organization_id,
            )
        )
        user = await db.get(User, user_id)
        return membership is not None and user is not None and user.is_active


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
        logger.exception("realtime_ticket_consume_failed organization_id=%s", organization_id)
        identity = None
    if identity is None or identity.organization_id != organization_id:
        await websocket.close(code=4401)
        return
    if not await _realtime_access_valid(identity.user_id, organization_id):
        await websocket.close(code=4403)
        return

    await manager.connect(organization_id, identity.user_id, websocket)
    await websocket.send_json({"type": "connected", "organization_id": str(organization_id)})
    try:
        while True:
            try:
                await asyncio.wait_for(websocket.receive_text(), timeout=30)
            except TimeoutError:
                pass
            if not await _realtime_access_valid(identity.user_id, organization_id):
                await websocket.close(code=4403)
                break
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception(
            "realtime_connection_failed organization_id=%s user_id=%s",
            organization_id,
            identity.user_id,
        )
    finally:
        manager.disconnect(organization_id, websocket)
