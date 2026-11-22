import hashlib
import logging
import time
from dataclasses import dataclass

from fastapi import Request
from redis.asyncio import from_url

from .config import settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class RateLimitDecision:
    allowed: bool
    retry_after: int = 0


_MEMORY_BUCKETS: dict[str, tuple[int, float]] = {}


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()[:24]


def client_address(request: Request) -> str:
    """The caller's IP, counting `aegis_trusted_proxy_hops` entries from the right of
    X-Forwarded-For. Entries further left are client-supplied and can be forged, so they are
    never used; without trusted hops every caller behind a proxy would share one bucket."""
    hops = settings.aegis_trusted_proxy_hops
    forwarded = request.headers.get("x-forwarded-for")
    if hops > 0 and forwarded:
        entries = [entry.strip() for entry in forwarded.split(",") if entry.strip()]
        if entries:
            return entries[max(0, len(entries) - hops)]
    return request.client.host if request.client else "unknown"


def client_fingerprint(request: Request) -> str:
    """Short, non-reversible client label for logs."""
    return _digest(client_address(request))[:10]


def _client_bucket(request: Request) -> str:
    return _digest(client_address(request))


async def consume_rate_limit(bucket: str, limit: int, window_seconds: int) -> RateLimitDecision:
    key = f"aegis:ratelimit:{bucket}"
    window = max(1, window_seconds)

    if settings.aegis_env.lower() == "production":
        redis = from_url(settings.redis_url, decode_responses=True)
        try:
            current = int(await redis.incr(key))
            if current == 1:
                await redis.expire(key, window)
            ttl = int(await redis.ttl(key))
        except Exception as exc:
            logger.warning("rate_limit_backend_unavailable error=%s", exc)
            return RateLimitDecision(allowed=True)
        finally:
            await redis.aclose()
        if current > limit:
            return RateLimitDecision(allowed=False, retry_after=max(1, ttl))
        return RateLimitDecision(allowed=True)

    now = time.time()
    current, expires_at = _MEMORY_BUCKETS.get(key, (0, now + window))
    if expires_at <= now:
        current, expires_at = 0, now + window
    current += 1
    _MEMORY_BUCKETS[key] = (current, expires_at)
    if current > limit:
        return RateLimitDecision(allowed=False, retry_after=max(1, int(expires_at - now)))
    return RateLimitDecision(allowed=True)


async def rate_limit_request(request: Request) -> RateLimitDecision:
    path = request.url.path
    method = request.method.upper()
    client = _client_bucket(request)

    if method == "POST" and path in {"/api/v1/auth/login", "/api/v1/auth/register"}:
        return await consume_rate_limit(f"auth:{client}", limit=12, window_seconds=60)

    if method == "POST" and path == "/api/v1/alerts/ingest":
        api_key = request.headers.get("x-aegis-key", "missing")
        return await consume_rate_limit(f"alerts:{_digest(api_key)}", limit=120, window_seconds=60)

    if method == "GET" and path.startswith("/api/v1/status/"):
        return await consume_rate_limit(f"status:{client}", limit=120, window_seconds=60)

    return RateLimitDecision(allowed=True)
