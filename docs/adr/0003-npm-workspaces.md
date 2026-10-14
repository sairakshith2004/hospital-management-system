# ADR 0003: npm workspaces monorepo

- **Status:** Accepted
- **Date:** 2026-10-14

## Context
The API and the web app share validation schemas, permission codes and enums. Keeping two copies of these would let them drift apart.

## Decision
Use one repository with npm workspaces:
- `apps/api`: the Express API
- `apps/web`: the React SPA
- `packages/shared`: Zod schemas, `permissions.ts` (the role→permission map) and enums

## Alternatives considered
- **Two repositories.** Shared code would need publishing or copying, and the two sides could disagree on what they share.
- **A single package with folders.** Frontend and backend dependencies would mix, and nothing would stop browser code from importing server-only code.

## Consequences
- One CI pipeline and one pull request per phase.
- The shared package must never import server-only code (database, secrets).
