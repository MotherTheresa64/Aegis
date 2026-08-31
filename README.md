# Aegis

[![CI](https://github.com/MotherTheresa64/Aegis/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/MotherTheresa64/Aegis/actions/workflows/ci.yml)
[![Live](https://img.shields.io/badge/deployment-live-success)](https://aegis-web-jvlk.onrender.com)
[![React](https://img.shields.io/badge/frontend-React%20%2B%20TypeScript-20232a)](https://react.dev/)
[![FastAPI](https://img.shields.io/badge/API-FastAPI-009688)](https://fastapi.tiangolo.com/)

**Real-Time Incident Operations Platform**

Aegis is a production-oriented, multi-tenant incident management platform for engineering teams. It brings service health, alert ingestion, incident coordination, realtime updates, dependency modeling, public status communication, audit history, webhooks, analytics, and postmortem workflows into one operational command center.

## Live deployment

**Web application:** https://aegis-web-jvlk.onrender.com  
**API:** https://aegis-api-l8f8.onrender.com  
**API documentation:** https://aegis-api-l8f8.onrender.com/docs  
**Health check:** https://aegis-api-l8f8.onrender.com/health

> `main` contains the current stable, CI-verified snapshot. The active Render deployment continues to track `build/foundation` while additional work is developed and validated.

## What Aegis demonstrates

Aegis is intentionally built as a systems-engineering project rather than a CRUD demo. The codebase demonstrates:

- Multi-tenant organizations with server-enforced RBAC
- Service catalogs, dependencies, health state, and blast-radius modeling
- Alert ingestion with API-key authentication and fingerprint deduplication
- Automatic incident creation and lifecycle management
- Realtime incident collaboration over authenticated WebSockets
- One-time, short-lived Redis-backed realtime connection tickets
- Incident timelines and response-task coordination
- Public status pages generated from live service state
- Signed outbound webhooks with retries and delivery history
- Audit logging for security-sensitive operations
- Async background execution with Celery
- PostgreSQL persistence with Alembic migrations
- Redis-backed ephemeral state and abuse controls
- Prometheus request metrics and DB/Redis readiness checks
- Security headers, rate limiting, tenant isolation, and hashed credentials
- GitHub Actions CI for API lint/tests and frontend typecheck/build
- Docker Compose local development

## Demo workflow

The fastest way to see the system work end-to-end:

1. Create a workspace and production service.
2. Select **Simulate outage**.
3. A SEV-1 alert automatically opens an incident and changes service health.
4. Open the incident command view and add timeline updates or response tasks.
5. Resolve the incident to restore service health.
6. Generate a structured postmortem draft from the preserved incident history.

## Architecture

```text
Browser / React + TypeScript
           |
           | HTTPS + WebSocket tickets
           v
      FastAPI API
       /       \
      /         \
PostgreSQL     Redis
 authoritative  ephemeral state,
 domain data    rate limits, tickets,
      |          queues
      |            |
      +------> Celery worker
                   |
             webhook delivery /
             async integrations
```

Aegis starts as a **modular monolith with an independently scalable worker**. Domain boundaries are kept explicit so components can be extracted only when scale, ownership, or failure isolation actually justifies it.

## Stack

| Layer | Technology |
| --- | --- |
| Frontend | React, TypeScript, Vite |
| API | Python, FastAPI |
| Database | PostgreSQL, SQLAlchemy, Alembic |
| Ephemeral state | Redis |
| Async work | Celery |
| Realtime | WebSockets + one-time Redis tickets |
| Observability | Prometheus metrics, structured request logging, health/readiness probes |
| DevOps | Docker Compose, GitHub Actions, Render |
| Security | JWT auth, bcrypt, RBAC, hashed API keys, signed webhooks, rate limiting, audit events |

## Repository layout

```text
Aegis/
├── apps/
│   ├── api/                 FastAPI application, worker, tests, migrations
│   └── web/                 React + TypeScript client
├── docs/
│   ├── architecture.md
│   └── decisions/           Architecture Decision Records
├── .github/workflows/       CI pipeline
├── docker-compose.yml       Local service orchestration
├── SECURITY.md              Security policy and reporting guidance
└── README.md
```

## Local development

```bash
cp .env.example .env
docker compose up --build
```

Then open:

- Web: `http://localhost:5173`
- API: `http://localhost:8000`
- API docs: `http://localhost:8000/docs`

## API and operational endpoints

- `GET /health` — process health
- `GET /ready` — PostgreSQL + Redis readiness
- `GET /metrics` — Prometheus metrics
- `POST /api/v1/alerts/ingest` — external alert ingestion
- `POST /api/v1/organizations/{id}/realtime-ticket` — one-time realtime authentication ticket
- `WS /ws/organizations/{id}?ticket=...` — organization-scoped realtime channel

## Engineering principles

- **Tenant isolation is enforced server-side.** Client state never determines authorization.
- **PostgreSQL is authoritative.** Redis is used only for ephemeral infrastructure responsibilities.
- **Secrets are never stored in plaintext when avoidable.** API keys are hashed and webhook signing secrets are encrypted.
- **Performance claims require measurements.** No fabricated latency or scale numbers are presented.
- **AI does not invent incident root causes.** Generated postmortem drafts explicitly leave root-cause validation to engineers.
- **Microservices are not a goal by themselves.** Services are extracted only when a concrete engineering reason exists.

## Project status

**Active and deployed.** The production foundation, primary incident workflow, authentication/RBAC, realtime ticket security, integrations, analytics, observability, migrations, and CI pipeline are operational. Additional product polish and scaling work continues through reviewed feature branches.
