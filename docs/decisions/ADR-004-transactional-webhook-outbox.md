# ADR-004: Persist webhook intent before asynchronous delivery

**Status:** Accepted

## Context

Incident, task, service, and alert mutations can produce outbound webhook events. Publishing a Celery task before the database commit risks delivering an event for state that later rolls back. Publishing only after commit without persisting delivery intent risks losing the webhook if the broker is unavailable at that moment.

Making the outbound HTTP request inside the domain transaction would avoid neither problem cleanly and would hold database resources open across an unreliable network boundary.

## Decision

Aegis uses the `webhook_deliveries` table as a transactional outbox for webhook intent.

The application stages webhook delivery rows in the same PostgreSQL transaction as the authoritative domain mutation. After commit, it attempts to enqueue those persisted delivery IDs to Celery. The worker reads the durable delivery row, performs the outbound request, records attempts/results, and applies bounded retry/dead-letter behavior.

## Consequences

- Authoritative state and webhook intent commit atomically.
- A broker outage cannot make an already-committed domain mutation appear rolled back to the caller.
- External HTTP latency is kept outside the database transaction.
- Delivery is at-least-once in nature; consumers should use the stable delivery identifier for idempotency.
- A full production deployment should include a reconciler/sweeper that republishes stale pending/failed outbox rows if task publication is interrupted after commit. Manual retry and persisted delivery history provide the current recovery path.
