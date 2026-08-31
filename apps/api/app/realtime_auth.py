import hashlib
import json
import secrets
import time
import uuid
from dataclasses import dataclass

from redis.asyncio import from_url

from .config import settings


@dataclass(frozen=True)
class RealtimeIdentity:
    user_id: uuid.UUID
    organization_id: uuid.UUID


_MEMORY_TICKETS: dict[str, tuple[str, float]] = {}


def _ticket_key(ticket: str) -> str:
    digest = hashlib.sha256(ticket.encode()).hexdigest()
    return f"aegis:realtime-ticket:{digest}"


def _serialize_identity(user_id: uuid.UUID, organization_id: uuid.UUID) -> str:
    return json.dumps({"user_id": str(user_id), "organization_id": str(organization_id)}, separators=(",", ":"))


def _deserialize_identity(payload: str) -> RealtimeIdentity:
    body = json.loads(payload)
    return RealtimeIdentity(
        user_id=uuid.UUID(body["user_id"]),
        organization_id=uuid.UUID(body["organization_id"]),
    )


async def issue_realtime_ticket(user_id: uuid.UUID, organization_id: uuid.UUID) -> str:
    ticket = f"aeg_rt_{secrets.token_urlsafe(32)}"
    key = _ticket_key(ticket)
    payload = _serialize_identity(user_id, organization_id)
    ttl = max(10, settings.aegis_realtime_ticket_seconds)

    if settings.aegis_env.lower() == "production":
        redis = from_url(settings.redis_url, decode_responses=True)
        try:
            await redis.set(key, payload, ex=ttl)
        finally:
            await redis.aclose()
    else:
        _MEMORY_TICKETS[key] = (payload, time.time() + ttl)

    return ticket


async def consume_realtime_ticket(ticket: str) -> RealtimeIdentity | None:
    if not ticket.startswith("aeg_rt_"):
        return None

    key = _ticket_key(ticket)
    payload: str | None

    if settings.aegis_env.lower() == "production":
        redis = from_url(settings.redis_url, decode_responses=True)
        try:
            payload = await redis.execute_command("GETDEL", key)
        finally:
            await redis.aclose()
    else:
        record = _MEMORY_TICKETS.pop(key, None)
        if record is None:
            return None
        payload, expires_at = record
        if expires_at < time.time():
            return None

    if not payload:
        return None

    try:
        return _deserialize_identity(payload)
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        return None
