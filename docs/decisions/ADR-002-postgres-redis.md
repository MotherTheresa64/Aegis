# ADR-002: PostgreSQL is authoritative; Redis is ephemeral

**Status:** Accepted

PostgreSQL stores tenant, service, incident, alert, integration, and audit records. Redis is reserved for queues, pub/sub, rate limiting, and cache state. Core correctness must never depend on Redis persistence.
