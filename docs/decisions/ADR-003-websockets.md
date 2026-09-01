# ADR-003: Authenticated WebSockets for incident collaboration

**Status:** Accepted

Aegis uses WebSockets for organization-scoped realtime operational updates.

The browser does not put its long-lived bearer token directly in the WebSocket URL. It first requests a short-lived realtime ticket over the authenticated HTTP API. Production tickets are stored in Redis, are scoped to one user and one organization, and are consumed atomically on connection.

The server verifies organization membership at connection time and periodically while the socket remains open. Membership removal also closes matching sockets on the current API process.

The current connection manager is process-local. This is sufficient for the present single-API-instance deployment model, but it is an explicit scaling boundary: multiple API replicas would require shared event fanout before cross-replica realtime delivery could be guaranteed.
