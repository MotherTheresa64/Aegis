# Aegis

**Real-Time Incident Operations Platform**

Aegis is a production-oriented incident management system for engineering teams. It combines service health, alert ingestion, incident coordination, realtime updates, public status pages, audit history, and postmortem workflows in one multi-tenant platform.

## Why this exists

Aegis is intentionally built as a systems-engineering project rather than a CRUD demo. The repository is designed to demonstrate frontend engineering, API design, relational modeling, authentication and RBAC, asynchronous processing, realtime communication, caching, observability, containerization, CI/CD, security boundaries, and infrastructure-as-code.

## Stack

- React + TypeScript + Vite
- Python + FastAPI
- PostgreSQL + SQLAlchemy
- Redis
- WebSockets
- Celery workers
- Docker Compose
- GitHub Actions
- OpenTelemetry-ready instrumentation

## Local development

```bash
cp .env.example .env
docker compose up --build
```

Then open:

- Web: http://localhost:5173
- API: http://localhost:8000
- API docs: http://localhost:8000/docs

## Repository layout

```text
apps/
  api/      FastAPI application and worker code
  web/      React/TypeScript client
docs/
  architecture.md
  decisions/
.github/workflows/
docker-compose.yml
```

## Product pillars

1. Multi-tenant organizations and role-based access
2. Service catalog and dependency-aware health
3. Alert ingestion and deduplication
4. Realtime incident rooms and timelines
5. Public status communication
6. Auditable operational history
7. Asynchronous notifications and integrations
8. Postmortem workflows and analytics
9. Production observability and deployment discipline

## Status

Active development. The initial production foundation lives on feature branches and is merged through pull requests.
