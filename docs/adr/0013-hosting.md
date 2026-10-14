# ADR 0013: Hosting

- **Status:** Accepted, with the provider to be confirmed by the Day 5 spike
- **Date:** 2026-10-14

## Context
The MVP needs managed hosting and a managed PostgreSQL that support this design, and hosting problems should surface early rather than on Day 28.

## Decision
- **Default:** Render for the API and the static web build, with Neon for PostgreSQL.
- **Fallbacks:** Railway for the app, Supabase for Postgres.
- **Hard requirements, all verified on Day 5:**
  - **PostgreSQL 17**, the same major version as development and CI (ADR 0006), with `btree_gist`, `pg_trgm`, `citext` and `pgcrypto`. If no acceptable provider offers 17, the deviation must be recorded in this ADR, and CI must also run against the production version.
  - deferrable constraint triggers, and separate owner and application roles
  - automated backups with a tested restore
  - HTTPS, and environment-variable secrets
  - a region in or near India
  - cookie and CORS settings that work for the session design (ADR 0004)
- **Data:** synthetic data only. Real patient data would first need a review of data residency and India's DPDP Act and Rules.

## Alternatives considered
- **A VPS with Docker Compose.** Full control, but the developer would own patching, TLS and backups.
- **Fly.io.** Viable. Kept in reserve.

## Consequences
- A dry-run deployment on Day 5 catches platform problems early.
- Any change of provider is recorded as an update to this ADR.
