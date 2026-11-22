# The hosted demo vs the full stack

The deployed link at `https://aegis-web-jvlk.onrender.com` is a **seeded demo workspace**.

The hosted site does have a live API, but it runs on Render's free plan and sleeps when idle.
If it doesn't answer within 2.5 seconds, the first visit opens `/demo` instead of a slow form. That route runs the *same console code* as the full product against an in-browser
API (`apps/web/src/demo/demoApi.ts`) that mirrors the server's rules: a service stays
degraded until every incident affecting it is resolved, resolved incidents can't be
reopened, simulated alerts open incidents and put the service into outage, postmortems
leave the root cause pending review. Everything you click works; changes live only in
that browser tab. Use **Exit demo** to reach the real sign-in, which wakes the API first.

A suggested ninety-second path:

1. Open the SEV1 incident from the overview, post an update and finish the rollback task.
2. Move it through monitoring to resolved, then check that Payments API recovered.
3. Draft the postmortem from the resolved incident.
4. Use **Simulate alert** to open a new incident the way a monitoring tool would.
5. Look at Dependencies (what an outage puts at risk) and the customer-facing status page.

What the demo does not exercise — tenant isolation, RBAC, alert ingestion with advisory-lock
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
| Alert ingestion and deduplication | `apps/api/app/routers/developer.py` |
| Realtime ticketing | `apps/api/app/realtime_auth.py`, `apps/api/app/main.py` |
| Webhook outbox and delivery | `apps/api/app/integrations.py`, `apps/api/app/worker.py` |
| Architecture decisions | `docs/decisions/` |
| API tests | `apps/api/tests/` |
| Web console | `apps/web/src/console/`, `apps/web/src/pages/` |
| Demo API | `apps/web/src/demo/demoApi.ts` |
