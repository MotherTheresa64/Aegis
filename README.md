# Aegis

[![CI](https://github.com/MotherTheresa64/Aegis/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/MotherTheresa64/Aegis/actions/workflows/ci.yml)
[![React](https://img.shields.io/badge/frontend-React%20%2B%20TypeScript-20232a)](https://react.dev/)
[![FastAPI](https://img.shields.io/badge/API-FastAPI-009688)](https://fastapi.tiangolo.com/)

**Real-Time Incident Operations Platform**

Aegis is a multi-tenant incident-operations application for engineering teams. It combines service health, alert ingestion, incident coordination, response tasks, dependency modeling, realtime updates, public status communication, audit history, outbound webhooks, analytics, and postmortem workflows in one system.

The project is intentionally a **modular monolith with an independently runnable worker**, not a microservice showcase. PostgreSQL owns business truth; Redis is reserved for ephemeral infrastructure concerns; Celery handles retryable integration work; the React client provides distinct desktop and mobile operating experiences.

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
- Responsive desktop/mobile UX with role-aware controls, keyboard focus, semantic dialogs, touch-sized actions, safe-area handling, and reduced-motion support

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

## Responsive UX

Mobile is an intentional product surface rather than a collapsed desktop layout.

- Desktop uses the persistent operations sidebar and dense operational tables.
- Mobile uses a five-position bottom navigation with a secondary platform sheet.
- Incident history becomes touch-friendly cards rather than an overflowing table.
- Incident command becomes a full-height mobile surface.
- Service creation behaves as a bottom sheet.
- Controls respect device safe areas and remain touch-sized.
- Keyboard focus is visible on desktop and dialogs expose semantic modal roles/labels.
- `prefers-reduced-motion` disables nonessential animation.

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
- Vitest API-client tests
- production Vite build

### Container job

- Docker Compose configuration parsing
- production API image build
- production web/Nginx image build

A merge should only be treated as release-ready after those checks are green.

## Deployment

The repository contains production-shaped API and web container targets. Hosted environments must provide production secrets, PostgreSQL, Redis, public API/web origins, and the appropriate `VITE_API_URL` / `VITE_WS_URL` values at web-image build time.

Previously configured Render URLs may exist for this project, but a hosted instance can lag the repository until its deployment is updated. The repository and CI status—not an unverified external deployment badge—are the source of truth for this revision.

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
7. Switch between desktop and mobile to demonstrate that operational workflows—not just CSS dimensions—change for the device.

That path highlights the project's strongest engineering decisions without relying on exaggerated performance or scale claims.
