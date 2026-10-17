# HospitalOS: architecture

Status: approved design, Day 2 (2026-10-14). Decisions are recorded in [`adr/`](adr/).

## 1. Shape

A **modular monolith**: one Express API, one React single-page app and one PostgreSQL 17 database, deployed together. Modules are divided by domain and share one database and one set of transaction tools.

```
Browser (React SPA)
  │ HTTPS · JSON · httpOnly session cookie · X-CSRF-Token header
  ▼
apps/api (Express)
  helmet → requestId → pino (redacted) → rateLimit → session → loadUser (active?) → csrf
  → route: validate(zod) → requirePermission(code) → controller
  → service: business rules · record-level access · transaction · audit
  → repo (Drizzle) → PostgreSQL 17
  errorHandler → { error: { code, message, requestId } }
```

## 2. Repository layout (npm workspaces)

```
apps/api/src/
  config/env.ts        Zod-validated environment, fails at boot
  db/schema/           Drizzle table definitions, one file per domain
  db/migrations/       generated SQL + hand-written SQL (EXCLUDE, triggers, grants)
  db/seed/             synthetic data only
  lib/                 audit, tx, money, time, numbering, idempotency, errors
  middleware/          auth, requirePermission, csrf, rateLimit, errorHandler
  modules/<domain>/    *.routes · *.controller · *.service · *.repo · *.schemas · *.test
apps/web/src/
  features/<domain>/   pages, forms, hooks
  components/ui/       shadcn/ui
  lib/api.ts           fetch wrapper (CSRF header, error mapping)
  routes/              role-based layouts (UX only; the server enforces access)
packages/shared/src/
  permissions.ts       permission codes + role→permission map (single source of truth)
  schemas/             Zod request/response schemas used by API and web
  enums.ts
docker-compose.yml     postgres:17 → hms_dev, hms_test
docs/
```

Backend domain modules: `auth`, `users`, `access`, `audit`, `patients`, `departments`, `doctors`, `appointments`, `clinical`, `prescriptions`, `pharmacy`, `inventory`, `billing`, `laboratory`, `hr`, `finance`, `equipment`, `marketing`, `reports`.

## 3. Rules every module follows

1. Routes only validate input, check permissions and delegate. Business rules belong in services.
2. Any operation that writes more than one row runs inside a single `db.transaction()`.
3. The acting user comes from the server-validated session, never from the request body or query.
4. **Authorization runs on every request.** It has two layers: a permission check at the route (`requirePermission`), and a record-level check in the service through the shared `access` module (care relationship, department, ownership).
5. The database enforces invariants as a backstop: FK, composite FK, CHECK, UNIQUE, EXCLUDE and deferred constraint triggers.
6. Nothing clinical, financial or audit-related is hard-deleted. Corrections are made with void, reversal, credit-note, amendment or addendum records. FKs use `ON DELETE RESTRICT`, except pure join tables, which cascade.
7. Audit rows are written in the same transaction as the change they describe. A read of clinical data writes its audit row before any data is returned. If that write fails, the request fails (fail closed).
8. Logs never contain patient fields, passwords, tokens or session IDs. This is enforced by pino redaction and a log-capture test.
9. "Today" means the current date in the hospital's time zone, computed on the server: `(now() AT TIME ZONE tz)::date`. The client's date is never trusted.
10. Safety rules such as expiry, substitution, discount limits and stock availability live in services, with database constraints behind them. The UI may show the same rules for convenience, but never as the only check.

## 4. Conventions

| Concern | Rule |
|---|---|
| Primary keys | `uuid` with a `gen_random_uuid()` default. Movements and audit rows use `bigint generated always as identity`. |
| Human-readable numbers | Postgres sequences for MRN, appointment, encounter, prescription, lab-order and dispensing numbers. Invoice, receipt, credit-note and refund numbers come from the row-locked `document_counters` table, gapless per fiscal year. |
| Money | `bigint` paise with integer math only. Percentages are stored in basis points (1000 = 10%). See ADR 0007. |
| Time | `timestamptz`. `date` is used only for date of birth, expiry, follow-up windows and visit dates. |
| Optimistic locking | A `version` column on patients, appointments, prescriptions and invoices. A stale write returns 409. |
| Idempotency | The client sends an `Idempotency-Key` (UUID) when dispensing, recording a payment or requesting a refund. The `idempotency_keys` table stores it with a hash of the request; this is the replay mechanism. Repeating the key returns the stored result; reusing it with a different payload returns 422. The UQ `idempotency_key` columns on `dispensings`, `payments` and `refunds` are database backstops. |
| Database roles | `hms_owner` runs migrations. `hms_app` runs the application and has no `DELETE` on clinical, financial or audit tables, and INSERT-only on `audit_logs`. |
| Extensions | `pgcrypto`, `citext`, `pg_trgm`, `btree_gist` |
| Configurable policy | The single-row `hospital_settings` table holds the care windows, discount threshold, near-expiry window, break-glass duration and alert threshold, prescription validity and day-close time. |
| Tests | Vitest against a real `hms_test` database. Concurrency tests open separate connections and fire requests in parallel with `Promise.all`. |

## 5. Global lock order

Every service that takes several locks takes them in this order, to avoid deadlocks:

appointment → prescription → prescription items → stock batches (ascending id) → invoice → payment → document counter

## 6. Environment

- Local development uses Docker (Docker Desktop or OrbStack) running `postgres:17.11-bookworm@sha256:3645570cccdfa447589da9f57dd740faa29b30938e861289a5574b6ca6b03826` with two databases: `hms_dev` and `hms_test`.
  - That digest is the multi-platform image index (linux/amd64 and linux/arm64/v8). It was checked against the registry and Docker Hub on 2026-10-14.
  - CI uses the same reference.
- Secrets live only in `.env`, which git ignores. A committed `.env.example` lists the variable names with no values.
- Production uses managed hosting and a managed PostgreSQL 17 instance (ADR 0013), confirmed by a Day 5 spike.

## 7. Scheduled work: the end-of-day job

Some transitions happen because time passes, not because a user acts. They are handled by a single **day-close job** in the API's `appointments` module, with steps registered by other modules.

| Step | Transition | Owning module |
|---|---|---|
| 1 | `booked` appointments with `visit_date < today` → `no_show`. This also moves linked follow-ups `booked` → `missed`. | appointments (follow-ups live in this module) |
| 2 | `pending` follow-ups with `due_to + follow_up_grace_days < today` → `missed` | appointments |
| 3 | `issued` or `partially_dispensed` prescriptions with `issued_at + prescription_validity_days < today` → `closed` | prescriptions |

**How it runs:**
- **Trigger:** an in-process scheduler (`node-cron`) at `hospital_settings.day_close_time` in the hospital's time zone. Users with `day_close:run` (ADM) can also start it by hand. Both paths call the same service.
- **On/off switch:** `hospital_settings.day_close_enabled` controls the scheduled run. When it's off, the scheduled run is skipped and logged. A manual run is always allowed.
- **Single run:** `pg_try_advisory_lock('day_close')` makes sure only one instance runs it at a time, even if the API is scaled out.
- **Idempotent:** each step selects only records still in the source state, and changes each record in its own short transaction. A rerun or a crash part-way through is safe.
- **Audit:** every transition writes an audit row with `actor_type = system`.
- **Not automated:** appointments stuck in `checked_in` or `in_consultation`, and emergency-access expiry. Expiry is computed when access is checked, so it needs no job.

The job is built on Day 9 (step 1) and extended on Day 13 (steps 2 and 3); see the [roadmap](roadmap.md).

## 8. Frontend styling plan

- **What we'll use:** Tailwind CSS for styling, and shadcn/ui for components. shadcn/ui copies component source into the repository, built on accessible Radix primitives, so there's no runtime UI kit to depend on. Theme colours are CSS variables, which leaves room for a dark mode later.
- **When:** installed on 2026-10-17 (10-day plan, Day 1) with the login page and app shell. Components are written by hand in shadcn/ui style in `apps/web/src/components/ui/` (no CLI), on Radix primitives from the `radix-ui` package. Icons, toasts and animation helpers were deferred to keep dependencies minimal.
- **Rules:** no other component library. Accessibility comes first: every interactive element is keyboard-reachable and labelled. Visual polish never takes time from the core workflows or from testing.
