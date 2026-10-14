# ADR 0002: Technology stack

- **Status:** Accepted
- **Date:** 2026-10-14

## Context
The repository was empty at the Day 1 audit, so there was no existing stack to keep. The stack should be mainstream, written in TypeScript end to end, and explainable in an interview.

## Decision
- **Frontend:** React, TypeScript, Vite, Tailwind CSS, shadcn/ui, React Router, React Hook Form, Zod.
- **Backend:** Node.js (v24 LTS was verified on the development machine), TypeScript, Express, Zod validation.
- **Database:** PostgreSQL 17 with Drizzle ORM. Migrations are versioned, and some are hand-written SQL.
- **Testing:** Vitest (unit and API integration), with Playwright for critical end-to-end paths if time allows.
- **Tooling:** npm, ESLint, Prettier, GitHub Actions.
- **Established libraries** handle sessions, password hashing, dates and PDFs. None of these are written from scratch.

## Alternatives considered
- **Next.js (full-stack).** It blurs the boundary between the UI and the API, and makes server-side authorization harder to reason about for one developer.
- **Prisma.** A good developer experience, but weaker support for raw SQL constraints such as EXCLUDE, deferred triggers and partial indexes.
- **NestJS.** More structure than a 30-day solo project needs.

## Consequences
- The same Zod schemas validate input in both the browser and the API.
- Some database features (exclusion constraints, triggers, grants) go into hand-written SQL migrations. Day 4 confirms exactly which.
