# The hosted demo vs the full stack

The deployed link at `https://aegis-web-jvlk.onrender.com` is a **read-only, seeded demo**.

It exists so a reviewer can walk the incident workflow in under ninety seconds with no
credentials and no infrastructure: a service catalog, an active SEV-1 incident, and the
resolution path. The hosted build deliberately ships without a live API, so account
creation and sign-in are disabled there rather than failing behind a form that cannot
succeed. On first visit the app detects the missing API and opens `/demo` directly.

Everything below that line — tenant isolation, RBAC, alert ingestion with advisory-lock
deduplication, realtime tickets, transactional webhook outbox, Celery retries, migrations,
Prometheus metrics — is real code in this repository and is covered by the API test suite
and CI migration replay.

## Running the real thing

```bash
docker compose up --build
```

That brings up PostgreSQL, Redis, the FastAPI service, the Celery worker and the web
client. Sign-in then works against the real API and every workflow in the README
walkthrough is live rather than seeded.

## Where to look in the code

| Area | Path |
| --- | --- |
| Tenant and RBAC dependencies | `apps/api/app/deps.py` |
| Alert ingestion and deduplication | `apps/api/app/routers/alerts.py` |
| Realtime ticketing | `apps/api/app/realtime.py` |
| Webhook outbox and delivery | `apps/api/app/routers/webhooks.py` |
| Architecture decisions | `docs/decisions/` |
| API tests | `apps/api/tests/` |
