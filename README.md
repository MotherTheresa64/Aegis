# Aegis

[![CI](https://github.com/MotherTheresa64/Aegis/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/MotherTheresa64/Aegis/actions/workflows/ci.yml)
[![React](https://img.shields.io/badge/frontend-React%20%2B%20TypeScript-20232a)](https://react.dev/)
[![FastAPI](https://img.shields.io/badge/API-FastAPI-009688)](https://fastapi.tiangolo.com/)

**Real-Time Incident Operations Platform**

Aegis is a multi-tenant incident-operations application for engineering teams. It combines service health, alert ingestion, incident coordination, response tasks, dependency modeling, realtime updates, public status communication, audit history, outbound webhooks, analytics, and postmortem workflows in one system.

The project is intentionally a **modular monolith with an independently runnable worker**, not a microservice showcase. PostgreSQL owns business truth; Redis is reserved for ephemeral infrastructure concerns; Celery handles retryable integration work; the React client provides distinct desktop and mobile operating experiences.

## Hosted demo vs the full stack

The deployed site (Render static site `aegis-web`) is backed by a live API service (`aegis-api`, Render free plan, PostgreSQL and Redis). Free services sleep when idle and take up to a minute to wake, so on first visit the client gives the API 2.5 seconds to answer `/health` and otherwise opens `/demo` straight away. The sign-in screen wakes the API and says so while it starts.

`/demo` is a **seeded demo workspace**: the real console running against an in-browser stand-in for the API that enforces the same service-health and lifecycle rules, so a reviewer can declare, update, resolve and write up incidents in under ninety seconds without an account. Changes stay in that browser tab. See [`DEMO.md`](DEMO.md) for a suggested path.

The hosted deployment runs the API process only; no separate Celery worker service is deployed there.

The complete system — FastAPI, PostgreSQL, Redis, the Celery worker, and authenticated WebSockets — runs locally:

```bash
docker compose up --build
```

The web client then signs in against the real API, and every workflow in the walkthrough below is live rather than seeded.

## What the project demonstrates

- Multi-tenant organizations with server-enforced membership and RBAC
- Password authentication with bcrypt and signed JWT access tokens
- Service catalogs, health state, and declared service dependencies
- External alert ingestion through revocable, hashed API credentials
- Active-alert deduplication scoped by organization, service, source, and fingerprint
- PostgreSQL advisory locking to serialize competing copies of the same alert identity
- Automatic incident creation with explicit system/integration attribution
- Incident timelines, response tasks, terminal resolution, and service-health invariants
- One-time realtime authentication tickets and organization-scoped WebSockets
- Membership revalidation for already-connected realtime clients
- Public status output generated from persisted service/incident state
- Tenant-scoped audit history for security-sensitive operations
- Timestamped HMAC-signed outbound webhooks with SSRF defenses, bounded retries, and dead-letter state
- Transactional persistence of webhook intent before asynchronous delivery
- Prometheus request metrics, structured request logging, health and dependency-readiness probes
- Explicit Alembic migrations with empty-database replay in CI
- Production-shaped Docker images plus Docker Compose development orchestration
- Responsive desktop/mobile UX with role-aware controls, keyboard focus, native dialogs, touch-sized actions, safe-area handling, and reduced-motion support
- A fully interactive demo workspace that runs the real console without a backend

## Core workflow

A representative end-to-end flow is:

1. A user creates an organization and a production service.
2. A monitoring client sends an alert with an organization-bound API key, or an authorized engineer uses the built-in simulation path.
3. Aegis validates the key/service, serializes matching concurrent deduplication checks in PostgreSQL, and either attaches the alert to an unresolved incident or creates a new incident.
4. The authoritative incident/service mutation and any outbound webhook-delivery intents commit together.
5. Realtime clients are notified after commit; Celery handles retryable webhook delivery separately from the database transaction.
6. Responders add timeline updates and progress response tasks.
7. Resolving an incident only restores a service to `operational` when no other unresolved incident still affects that service.
8. A resolved incident can produce a structured postmortem draft whose root cause remains explicitly pending human validation.

## Architecture

```text
Browser / React + TypeScript
        | HTTPS
        | one-time WebSocket ticket
        v
FastAPI application --------------------+
        |                                |
        | authoritative transactions     | process-local socket fanout
        v                                v
   PostgreSQL                        WebSocket clients
        |
        | persisted webhook delivery intents
        v
   Celery worker <---- Redis broker / result backend
        |
        v
 outbound HTTPS webhooks

Redis also backs production rate-limit counters and short-lived realtime tickets.
```

PostgreSQL is authoritative. Redis does **not** contain business truth. Current WebSocket fanout is process-local; cross-replica realtime fanout is deliberately documented as a scaling boundary rather than represented as already implemented.

For the deeper design, see [`docs/architecture.md`](docs/architecture.md) and the ADRs in [`docs/decisions`](docs/decisions).

## Stack

| Layer | Technology |
| --- | --- |
| Frontend | React, TypeScript, Vite |
| API | Python, FastAPI |
| Persistence | PostgreSQL, SQLAlchemy, Alembic |
| Ephemeral/queue infrastructure | Redis |
| Background execution | Celery |
| Realtime | WebSockets + one-time tickets |
| Observability | Prometheus metrics, request IDs/logging, health/readiness probes |
| Local orchestration | Docker Compose |
| Production web container | Nginx serving the Vite build |
| CI | GitHub Actions |
| Security | bcrypt, JWT, RBAC, hashed/revocable API keys, encrypted webhook secrets, HMAC signatures, rate limits, audit events |

## Repository layout

```text
Aegis/
├── apps/
│   ├── api/
│   │   ├── app/              FastAPI domain/application code
│   │   ├── migrations/       Explicit Alembic migration history
│   │   └── tests/            API, security, tenant, and failure-path tests
│   └── web/
│       └── src/              Responsive React/TypeScript client + client tests
├── docs/
│   ├── architecture.md
│   └── decisions/            Architecture Decision Records
├── .github/workflows/ci.yml
├── docker-compose.yml
├── SECURITY.md
└── README.md
```

## Local development

Prerequisites if you are using Docker Compose directly:

- Docker with Compose v2
- open ports `5173`, `8000`, `5432`, and `6379`

Start from a fresh clone:

```bash
cp .env.example .env
docker compose up --build
```

Open:

- Web: `http://localhost:5173`
- API: `http://localhost:8000`
- OpenAPI / Swagger UI: `http://localhost:8000/docs`
- Process health: `http://localhost:8000/health`
- Dependency readiness: `http://localhost:8000/ready`
- Prometheus metrics: `http://localhost:8000/metrics`

Docker Compose intentionally targets the **development** stages/processes: Uvicorn reload for the API and the Vite dev server for the web client. The default Dockerfile targets are production-shaped and do not enable hot reload.

### Run the API without Docker

```bash
cd apps/api
python -m venv .venv
source .venv/bin/activate  # Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -e '.[dev]'
alembic upgrade head
uvicorn app.main:app --reload
```

Set `DATABASE_URL` and `REDIS_URL` for the services you want to use. SQLite is supported by the default development configuration for lightweight local API work; PostgreSQL is the intended authoritative production database.

### Run the web client without Docker

```bash
cd apps/web
npm install
npm run dev
```

The repository pins direct frontend dependency versions and CI installs them from a clean checkout before typechecking, testing, and building.

## Useful API surfaces

- `POST /api/v1/auth/register` — create an owner and organization
- `POST /api/v1/auth/login` — obtain an access token
- `GET /api/v1/auth/memberships` — list organizations/roles for the user
- `POST /api/v1/organizations/{id}/realtime-ticket` — issue a one-time WebSocket ticket
- `WS /ws/organizations/{id}?ticket=...` — organization realtime channel
- `POST /api/v1/alerts/ingest` — external alert ingestion using `X-Aegis-Key`
- `GET/POST /api/v1/organizations/{id}/api-keys` — API-key administration
- `DELETE /api/v1/organizations/{id}/api-keys/{key_id}` — revoke an API key
- `GET /api/v1/organizations/{id}/audit` — bounded owner/admin audit history
- `GET/POST/PATCH /api/v1/organizations/{id}/incidents/...` — incident response workflow
- `GET/POST /api/v1/organizations/{id}/webhooks...` — outbound webhook management/delivery history
- `GET /api/v1/status/{organization_slug}` — public status model

The generated `/docs` endpoint is the source of truth for complete request/response schemas.

## Roles

| Role | Intended capability |
| --- | --- |
| Owner | Full organization administration and operations |
| Admin | Organization administration and operations, subject to owner safeguards |
| Engineer | Service catalog/topology changes and incident operations |
| Responder | Incident response operations |
| Viewer | Read-only operational access |

The frontend hides controls the current role cannot use, but authorization is always enforced again on the server.

## Consistency and failure behavior

### Webhook outbox boundary

Aegis persists webhook-delivery intent in the database transaction that owns the domain change, then publishes the persisted delivery to Celery only after commit. Outbound HTTPS calls occur in the worker, not inside the authoritative database transaction.

This prevents a broker/network failure from turning a successful incident mutation into an apparent rollback that encourages a duplicate client retry. It also preserves an inspectable delivery record for manual retry/dead-letter handling.

The current implementation does not include an automatic outbox sweeper. A mature multi-instance deployment should add a reconciler for stale pending/failed rows; that limitation is documented in ADR-004 rather than hidden.

### Alert concurrency

Fingerprint deduplication is not global. It uses organization + service + source + fingerprint. PostgreSQL advisory locks serialize only competing copies of that identity before the unresolved-incident check.

### Service state

A resolved incident is terminal. A service is not restored to operational while another unresolved incident still affects it, and manual status changes enforce the same invariant.

## Security notes

See [`SECURITY.md`](SECURITY.md) for the full threat model. Important current boundaries include:

- tenant checks are server-side;
- password hashes use bcrypt;
- access tokens are signed JWT bearer tokens;
- browser logout removes the token locally but there is no server-side JWT revocation table, so a stolen token remains valid until expiration unless the user is deactivated/signing key is rotated;
- API keys are one-time-revealed, hashed/verifier-only at rest, and revocable;
- webhook URLs are restricted to public HTTPS destinations and re-resolved before delivery;
- webhook requests are timestamped and HMAC-signed;
- realtime tickets are short-lived, single-use, and organization-scoped;
- production configuration fails closed for weak/default application secrets and wildcard/missing CORS origins.

## Web client

`apps/web/src` is organized by responsibility:

| Path | Contents |
| --- | --- |
| `console/` | App shell, workspace switching, realtime connection, active-incident strip, shared dialogs |
| `pages/` | One file per view: overview, incidents, incident command, services, dependencies, analytics, integrations, status page, team & audit |
| `ui/` | Badges, native `<dialog>` wrapper, toasts and confirmations, data/mutation hooks |
| `lib/` | Formatting, role checks, hash routing, theme, dependency blast-radius graph |
| `demo/` | In-browser API used by `/demo` |
| `public/` | Unauthenticated status page |

Design choices:

- Colour is reserved for operational state (severity and status); everything else is neutral. Light and dark themes follow the system setting or a manual choice.
- Views are hash-routed (`#/incidents/<id>`) so incidents can be linked and survive refresh on static hosts with no rewrite rules.
- The incident page is the centre of the product: a lifecycle stepper, a newest-first timeline with a composer, response tasks, details and the postmortem draft.
- On phones the sidebar becomes a bottom tab bar with a one-tap **Declare** action, tables reflow into labelled rows, dialogs become bottom sheets, and controls are at least 44px tall.
- Dialogs use native `<dialog>` for focus containment and Escape handling; destructive actions go through a confirmation dialog; `prefers-reduced-motion` disables animation.

## Verification

GitHub Actions is configured to run from a clean checkout and verify:

### API job

- dependency installation
- Ruff linting
- Python bytecode compilation
- empty-database Alembic `upgrade head`
- Alembic `downgrade base` followed by a second `upgrade head`
- pytest regression suite

### Web job

- pinned Node runtime
- clean dependency installation
- TypeScript typecheck
- Vitest unit tests (API client, routing, dependency graph, demo API rules)
- Playwright mobile end-to-end flows against the demo workspace and mocked API routes
- production Vite build

### Container job

- Docker Compose configuration parsing
- production API image build
- production web/Nginx image build

A merge should only be treated as release-ready after those checks are green.

## Deployment

The repository contains production-shaped API and web container targets. Hosted environments must provide production secrets, PostgreSQL, Redis, public API/web origins, and the appropriate `VITE_API_URL` / `VITE_WS_URL` values at web-image build time.

Both Render services (`aegis-web` static site, `aegis-api` web service) auto-deploy from `main`; merging to `main` is a production deploy. The API runs Alembic migrations on startup.

## Engineering tradeoffs / known boundaries

These are deliberate current boundaries, not hidden “enterprise” claims:

- WebSocket fanout is process-local; horizontal API scaling needs a shared fanout layer.
- JWT access tokens are stateless and do not have a server-side per-token revocation store.
- The webhook outbox has durable rows and retry APIs but no automatic stale-row sweeper yet.
- Rate limiting fails open if Redis is unavailable; edge/gateway rate limiting is recommended for a public high-risk deployment.
- No Kubernetes, Terraform, multi-region architecture, autoscaling, or fabricated scale/latency/SLA claims are included.
- Postmortem generation is deterministic assistance from persisted incident history; it does not invent an incident root cause.

## Recruiter / interview walkthrough

A useful technical walkthrough is:

1. Start with the tenant/RBAC boundary in `deps.py` and tenant-scoped routers.
2. Trace external alert ingestion through API-key verification, service lookup, advisory-lock deduplication, and system-attributed incident creation.
3. Follow a domain mutation into the transactional webhook-delivery rows, then into Celery delivery/retry behavior.
4. Explain why Redis is ephemeral and why PostgreSQL remains authoritative.
5. Demonstrate one-time realtime tickets and discuss the explicit process-local fanout limitation.
6. Show deterministic migrations and the CI migration replay.
7. Open `/demo` on a phone and run an incident end to end: the same console code runs against an in-browser API, which is also how the hosted link works without infrastructure.

That path highlights the project's strongest engineering decisions without relying on exaggerated performance or scale claims.
