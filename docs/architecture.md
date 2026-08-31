# Aegis Architecture

## System shape

Aegis begins as a modular monolith with an independently scalable background worker. This is deliberate: service boundaries remain explicit without paying the operational cost of premature microservices.

```text
Browser
  | HTTPS / WebSocket
  v
React client
  |
  v
FastAPI application ---- Redis ---- Celery worker
  |                \       |
  |                 \-- realtime/event fanout
  v
PostgreSQL
```

## Bounded modules

- Identity: users, authentication, sessions
- Tenancy: organizations, memberships, roles
- Catalog: services and service health
- Incidents: lifecycle, participants, events, tasks
- Alerts: ingestion, normalization, deduplication
- Integrations: API keys, webhooks, outbound delivery
- Status: externally visible service and incident communication
- Audit: security and operational history

## Multi-tenancy

Every tenant-owned row includes `organization_id`. Authorization checks always combine authenticated identity with organization membership; object IDs alone never authorize access.

## Realtime

WebSocket clients subscribe to organization channels. Application events are published through Redis so multiple API replicas can fan updates to their connected clients.

## Async work

Long-running or retryable work is delegated to Celery: webhook delivery, notifications, postmortem generation, analytics rollups, and alert enrichment.

## Data consistency

PostgreSQL is authoritative. Redis contains ephemeral cache, rate-limit, queue, and fanout state only. Losing Redis must not destroy business records.

## Deployment path

Local development uses Docker Compose. Production infrastructure will be defined with Terraform and will separate web, API, worker, PostgreSQL, Redis, secrets, telemetry, and DNS.
