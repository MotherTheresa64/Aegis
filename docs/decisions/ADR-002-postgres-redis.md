# ADR-002: PostgreSQL is authoritative; Redis is ephemeral

**Status:** Accepted

PostgreSQL stores tenant, service, incident, alert, task, integration, audit, and postmortem records. Core correctness must not depend on Redis persistence.

Redis is used for responsibilities that are intentionally ephemeral or queue-related:

- Celery broker/result transport
- production rate-limit counters
- short-lived, single-use realtime authentication tickets

Realtime WebSocket fanout is currently process-local; Redis pub/sub is not implemented and is therefore not part of the current architecture. A shared fanout layer would be a separate scaling decision if multiple API replicas become necessary.
