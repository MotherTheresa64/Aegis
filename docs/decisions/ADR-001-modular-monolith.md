# ADR-001: Start with a modular monolith

**Status:** Accepted

## Decision

Aegis will start as one FastAPI deployable with strongly separated domain modules, plus independent background workers.

## Rationale

The domain is complex enough to benefit from boundaries but not yet proven to require network-separated services. A modular monolith keeps transactions simple, local development fast, and operational overhead low while preserving future extraction paths.

## Extraction signals

A module becomes a service only when independent scaling, blast-radius isolation, ownership, security, or release cadence justifies the network boundary.
