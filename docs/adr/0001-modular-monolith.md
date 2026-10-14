# ADR 0001: Modular monolith

- **Status:** Accepted
- **Date:** 2026-10-14

## Context
One developer has 30 days to build an integrated hospital system. The domains depend on each other heavily. For example, dispensing changes stock and billing in a single operation.

## Decision
Build one deployable application: an Express API plus a React SPA, backed by one PostgreSQL database. The backend is split into domain modules (`patients`, `appointments`, `pharmacy`, `billing`, and so on). Each module has its own routes, controller, service, repository, schemas and tests. Modules call each other's **services**, never each other's tables directly.

## Alternatives considered
- **Microservices.** Workflows such as dispensing plus billing would need distributed transactions or sagas, along with service discovery, multiple deployments and network failure handling. That's far too much to operate for one developer.
- **An unstructured monolith.** Quick at first, but business logic would leak into routes and React components, and the code would be hard to test or explain.

## Consequences
- Workflows that touch several domains can use a single ACID transaction.
- One deployment, one database and one CI pipeline.
- Module boundaries are kept by convention and code review, not by the network. A module could be extracted later if it ever needed to scale on its own.
