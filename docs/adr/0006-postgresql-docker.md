# ADR 0006: PostgreSQL 17 in Docker for local development

- **Status:** Accepted
- **Date:** 2026-10-14

## Context
The Day 1 audit found no PostgreSQL, Docker or Homebrew on the development machine. Integrity rules depend on Postgres-specific features: EXCLUDE constraints, row locks, advisory locks, deferred triggers and partial indexes.

## Decision
- The developer installs Docker Desktop or OrbStack. This is a manual step and is not automated by this project.
- `docker-compose.yml` runs `postgres:17.11-bookworm`, **pinned by image digest** (`sha256:3645570c…3826`, verified on 2026-10-14), with two databases: `hms_dev` and `hms_test`.
  - A tag can be re-pointed upstream, but a digest can't.
  - The Debian variant is fixed because changing the OS text library (glibc) can change text sort order and invalidate indexes.
- Required extensions: `pgcrypto`, `citext`, `pg_trgm`, `btree_gist`.
- Two database roles:
  - `hms_owner` runs migrations.
  - `hms_app` runs the application, with no DELETE on clinical, financial or audit tables and INSERT-only on `audit_logs`.
- CI uses the same digest-pinned image as a service container.

## Alternatives considered
- **Postgres.app.** Simpler on macOS, but there's no identical image for CI.
- **A cloud development database (Neon).** No install needed, but development then depends on the network, and test isolation is harder.
- **SQLite.** No EXCLUDE constraints and no row-level locking.

## Consequences
- Development, test and CI all run the same Postgres version.
- Docker must be installed before Day 3.
