from fastapi.testclient import TestClient
from starlette.requests import Request

from app.config import Settings, settings
from app.main import app
from app.ratelimit import client_address


def make_request(forwarded: str | None, peer: str = "10.0.0.9") -> Request:
    headers = [(b"x-forwarded-for", forwarded.encode())] if forwarded else []
    return Request({"type": "http", "headers": headers, "client": (peer, 1234)})


def test_client_address_uses_proxy_appended_entry_not_spoofed_ones(monkeypatch) -> None:
    monkeypatch.setattr(settings, "aegis_trusted_proxy_hops", 1)
    assert client_address(make_request("203.0.113.7")) == "203.0.113.7"
    # A client that sends its own header can only add entries to the left.
    assert client_address(make_request("1.2.3.4, 203.0.113.7")) == "203.0.113.7"
    assert client_address(make_request(None)) == "10.0.0.9"


def test_client_address_ignores_forwarded_header_without_trusted_proxies(monkeypatch) -> None:
    monkeypatch.setattr(settings, "aegis_trusted_proxy_hops", 0)
    assert client_address(make_request("1.2.3.4")) == "10.0.0.9"


def test_metrics_are_private_in_production(monkeypatch) -> None:
    with TestClient(app) as client:
        assert client.get("/metrics").status_code == 200

        monkeypatch.setattr(settings, "aegis_env", "production")
        monkeypatch.setattr(settings, "aegis_metrics_token", "")
        assert client.get("/metrics").status_code == 404

        monkeypatch.setattr(settings, "aegis_metrics_token", "scrape-token-for-tests")
        assert client.get("/metrics", headers={"Authorization": "Bearer wrong"}).status_code == 404
        allowed = client.get("/metrics", headers={"Authorization": "Bearer scrape-token-for-tests"})
        assert allowed.status_code == 200
        assert "http_requests" in allowed.text or "aegis" in allowed.text


def test_queue_urls_default_to_redis_url() -> None:
    configured = Settings(redis_url="redis://cache.internal:6379/0", celery_broker_url="", celery_result_backend="")
    assert configured.celery_broker_url == "redis://cache.internal:6379/0"
    explicit = Settings(redis_url="redis://a:6379/0", celery_broker_url="redis://b:6379/1")
    assert explicit.celery_broker_url == "redis://b:6379/1"


def test_embedded_worker_is_restarted_after_it_exits(monkeypatch) -> None:
    import asyncio
    import sys

    from app import embedded_worker

    monkeypatch.setattr(embedded_worker, "WORKER_COMMAND", [sys.executable, "-c", "pass"])
    monkeypatch.setattr(embedded_worker, "RESTART_DELAY_SECONDS", 0)
    started = []
    original = embedded_worker.start_embedded_worker
    monkeypatch.setattr(embedded_worker, "start_embedded_worker", lambda: started.append(1) or original())

    async def scenario() -> None:
        holder = {"process": original()}
        task = asyncio.create_task(embedded_worker.supervise_embedded_worker(holder))
        for _ in range(100):
            if len(started) >= 2:
                break
            await asyncio.sleep(0.05)
        task.cancel()
        embedded_worker.stop_embedded_worker(holder["process"])

    asyncio.run(scenario())
    assert len(started) >= 2


def test_startup_migrations_do_not_silence_application_logs() -> None:
    import logging

    with TestClient(app) as client:
        client.get("/health")
    assert not logging.getLogger("aegis").disabled
    assert not logging.getLogger("app.worker").disabled
