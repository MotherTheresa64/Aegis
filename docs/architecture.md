# Aegis Architecture

## System shape

Aegis is a modular monolith with an independently runnable Celery worker. The architecture keeps domain boundaries explicit without introducing network boundaries that the current product does not need.

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

Redis also backs production rate-limit counters and single-use realtime tickets.
```

## Domain boundaries

- **Identity** — users, password authentication, bearer-token validation
- **Tenancy** — organizations, memberships, invitations, and roles
- **Catalog** — services, status, and declared dependencies
- **Incidents** — lifecycle, timeline events, response tasks, and postmortems
- **Alerts** — external ingestion, normalization, and active-incident deduplication
- **Integrations** — revocable API keys, webhook endpoints, delivery attempts, and dead-letter state
- **Status** — public service and active-incident communication
- **Audit** — tenant-scoped history for security-sensitive mutations

## Multi-tenancy and RBAC

Tenant authorization is enforced in the API. Tenant-owned queries constrain both the organization boundary and the target resource; client-selected IDs never grant access by themselves.

Roles are intentionally coarse-grained for the current product:

- `owner` — full tenant administration
- `admin` — tenant administration except owner-only safeguards
- `engineer` — service and incident operations
- `responder` — incident response operations
- `viewer` — read-only operational access

## Authoritative state and transaction boundaries

PostgreSQL is the system of record. A request that changes authoritative domain state commits that state before best-effort realtime fanout or task publication can affect the response.

Outbound webhook intent uses the `webhook_deliveries` table as a transactional outbox. Domain changes and matching delivery rows are staged in the same database transaction. Celery publication happens after commit. If the broker is temporarily unavailable, the authoritative mutation remains committed and the durable delivery record can be retried rather than encouraging a client to repeat the domain mutation.

## Alert deduplication and concurrency

A fingerprint is not globally unique. Active-alert deduplication is scoped by organization, service, source, and fingerprint. In PostgreSQL, competing copies of that same alert identity acquire a transaction-scoped advisory lock before checking for an existing unresolved incident. This narrows serialization to the race that matters instead of locking the entire ingestion path.

## Realtime

The browser first requests a short-lived, single-use realtime ticket over the authenticated HTTP API. Production tickets are stored in Redis and consumed atomically. The WebSocket handshake then verifies the ticket's user and organization membership.

Connected sockets are tracked in-process. Membership/account state is revalidated periodically, and local sockets are closed when organization access is removed.

**Current scaling boundary:** socket fanout is process-local. Multiple API replicas would require a shared fanout layer (for example Redis pub/sub or another broker) before Aegis could guarantee cross-replica realtime delivery. The current implementation does not claim that capability.

## Async work and webhook delivery

Celery is used for retryable integration work. Webhook delivery:

1. reads a persisted delivery and endpoint,
2. revalidates the public HTTPS destination,
3. signs the timestamped body with HMAC-SHA256,
4. sends with redirects disabled and a bounded timeout,
5. records response/error state,
6. retries transient failures with bounded backoff,
7. moves exhausted deliveries to `dead_letter`.

The API never holds a database transaction open while making the outbound network request.

## Security boundaries

- Passwords use bcrypt hashes.
- JWT access tokens have required issuer/subject/issued-at/expiration/token-id claims.
- API keys are shown once and only their verifier is retained; keys can be revoked.
- Webhook signing secrets are encrypted at rest using key material derived from the application secret.
- Webhook URLs are HTTPS-only and checked against private/reserved network destinations both at configuration time and immediately before delivery.
- Realtime tickets are single-use and organization-scoped.
- Security-sensitive mutations emit audit events.
- Production configuration rejects the development secret and wildcard/missing CORS origins.

## Observability and failure behavior

- `/health` reports process liveness.
- `/ready` checks PostgreSQL and Redis and returns `503` when a dependency is unavailable.
- `/metrics` exposes Prometheus request counters and latency histograms.
- HTTP responses include request IDs and baseline security headers.
- Unexpected HTTP failures are logged server-side and return a generic response containing the request ID rather than raw exception details.

## Persistence and migrations

Alembic is the authoritative schema mechanism. Migration revisions contain explicit schema operations rather than importing current ORM metadata into historical revisions. CI replays upgrade → downgrade → upgrade against an empty database to catch migration-history regressions.

## Frontend and responsive strategy

Desktop uses a persistent operations sidebar and dense tables where that density is useful. Mobile uses a fixed bottom navigation, a secondary navigation sheet, card-based incident presentation, touch-sized controls, full-height incident command, and bottom-sheet service creation. The UI hides mutation controls that the signed-in role cannot perform rather than presenting actions that only fail with a `403`.

The interface includes visible keyboard focus, semantic dialogs, explicit incident-open buttons, accessible icon labels, safe-area padding, and a reduced-motion mode.

## Deployment model

Docker Compose is intentionally a **development** environment: PostgreSQL, Redis, a reload-enabled API process, the Celery worker, and the Vite development server.

The default Dockerfiles are production-shaped instead:

- the API image includes Alembic configuration/migrations and runs Uvicorn without reload as a non-root user;
- the web image builds static Vite assets and serves them through Nginx with SPA fallback and baseline security headers.

No Terraform, Kubernetes, multi-region, autoscaling, or cross-replica realtime capability is claimed because those are not implemented in this repository.
