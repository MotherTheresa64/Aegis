# Security Policy

## Security model

Aegis treats tenant isolation, credential handling, and external integration boundaries as primary security concerns. Tenant-owned API operations authorize the authenticated user against organization membership and the required role before accessing or mutating organization data.

## Threat model

The current implementation explicitly addresses these risks:

### Cross-tenant data access

Tenant-owned records are selected with organization constraints and membership/RBAC checks. Resource IDs from the browser are identifiers, not authorization grants.

### Password and bearer-token compromise

Passwords are stored as bcrypt hashes. Access tokens are signed JWT bearer tokens with required issuer, subject, issued-at, expiration, and token-ID claims. Inactive users are rejected on authenticated requests.

The browser currently stores the access token in `localStorage`. Logout removes the browser copy, but the server does **not** maintain a JWT revocation/session table, so a stolen access token remains valid until its configured expiration unless the signing key is rotated or the user is deactivated. This is an explicit current tradeoff, not a server-side session-revocation claim.

### API-key disclosure

API keys are revealed once. The database retains only a verifier and display prefix. Owner/admin users can revoke a key, which removes the verifier so the old plaintext key can no longer authenticate alert ingestion.

### Webhook secret disclosure and forgery

Webhook signing secrets are encrypted at rest. Deliveries use HMAC-SHA256 signatures over a timestamped payload. Receivers should enforce a timestamp tolerance and deduplicate by the stable delivery identifier to reduce replay risk.

### Server-side request forgery through webhooks

Webhook endpoints must use HTTPS, cannot contain embedded credentials, and cannot target literal private/reserved addresses. Before each delivery, the hostname is resolved again and all resolved addresses must be globally routable. Redirects are disabled and outbound requests use a bounded timeout.

As with any DNS-based SSRF defense, network egress controls remain a recommended additional production layer.

### Brute force and abusive ingestion

Authentication, alert-ingestion, and public-status paths are rate-limited. Production counters are stored in Redis. The current rate limiter fails open if Redis is unavailable so a Redis outage does not become a full API outage; edge/gateway rate limiting is recommended as an additional production layer.

### Realtime credential leakage and stale authorization

The long-lived bearer token is not placed directly in the WebSocket URL. Authenticated clients request a short-lived, one-time ticket scoped to a user and organization. Membership is checked at connect time and periodically while the socket remains active. Membership removal closes matching sockets on the current process.

Realtime fanout itself is process-local; this repository does not claim cross-replica WebSocket delivery.

### Outbound side-effect inconsistency

Webhook delivery intent is persisted transactionally with the authoritative domain mutation and delivered asynchronously afterward. This keeps external network calls outside database transactions and avoids asking clients to repeat an already-committed domain mutation because a task broker was temporarily unavailable.

## Production configuration safeguards

Production mode rejects:

- the development/default application secret,
- application secrets shorter than 32 characters,
- missing CORS origins,
- wildcard CORS origins.

Production secrets belong in the deployment platform's secret store or environment, never in source control.

## Reporting vulnerabilities

Please do not open public issues for exploitable vulnerabilities. Use GitHub private vulnerability reporting when it is enabled for the repository.

## Development rules

- Never commit secrets, raw API keys, webhook signing secrets, or production credentials.
- Keep tenant authorization in server-side query/mutation paths.
- Validate externally supplied data and URLs.
- Use parameterized ORM/database access.
- Apply the least-privilege role that fits an operation.
- Record security-sensitive mutations in the audit trail.
- Keep outbound network requests outside authoritative database transactions.
- Rotate compromised application secrets and revoke compromised API keys immediately.
- Do not present security controls in documentation or UI that the implementation does not enforce.
