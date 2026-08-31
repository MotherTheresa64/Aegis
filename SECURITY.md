# Security Policy

## Security model

Aegis treats tenant isolation as a primary security boundary. All tenant-owned API operations must authorize the authenticated user against organization membership before data access.

## Reporting vulnerabilities

Please do not open public issues for exploitable vulnerabilities. Use GitHub's private vulnerability reporting feature when enabled.

## Development rules

- Never commit secrets or production credentials.
- Store API keys hashed at rest.
- Validate all externally supplied data.
- Use parameterized ORM/database access.
- Apply least-privilege RBAC.
- Log security-sensitive mutations in the audit trail.
- Rotate compromised credentials immediately.
