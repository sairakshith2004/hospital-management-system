# hospital-management-system

**HospitalOS** is an outpatient Hospital Management System for a single multispecialty hospital, built by one developer. **Since 2026-10-17 the remaining work is planned as a 10-day MVP** (see [`docs/roadmap.md`](docs/roadmap.md)). It is a **modular monolith**: a React web app, an Express API and a PostgreSQL database in one repository.

> ⚠️ **Synthetic data only.** This project has not been assessed against India's DPDP Act and Rules or clinical-records requirements. Do not put real patient data in it without legal, clinical and security review. The system never diagnoses patients or recommends treatment.

This README is updated with every change, so it always describes how the project currently works. The detailed design lives in [`docs/`](docs/).

---

## Contents

1. [Current status](#current-status)
2. [Technology stack](#technology-stack)
3. [Repository layout](#repository-layout)
4. [Prerequisites](#prerequisites)
5. [Getting started](#getting-started)
6. [Running the API](#running-the-api)
7. [Running the web app](#running-the-web-app)
8. [Local database](#local-database)
9. [npm scripts](#npm-scripts)
10. [Code quality tooling](#code-quality-tooling)
11. [Security practices](#security-practices)
12. [Git workflow](#git-workflow)
13. [Design documents](#design-documents)
14. [Roadmap](#roadmap)
15. [Change log](#change-log)

---

## Current status

| Phase | State |
|---|---|
| Day 1: repository and environment audit | ✅ Done |
| Day 2: architecture design (requirements, ERD, permissions, state machines, ADRs, roadmap) | ✅ Done, merged to `main` (PR #1) |
| Day 3: project foundation | ✅ Done, merged to `main` (PRs #2 and #3). CI was added in Day 4 Step 6. |
| Scope alignment (C1–C4) | ✅ Done, merged to `main` (PR #4) |
| Day 4: database schema and migrations | 🚧 In progress on `phase/day-04-database`. Step 1 (role reconciliation) is committed. Step 2a (database tooling: packages, role and migration scripts, environment checks) is written and checked locally. Step 2b (role setup) is done: `hms_owner` and `hms_app` exist on `hms_dev` and `hms_test` with the documented privileges, and `PUBLIC` access to both databases is removed. Step 3 (schema and first migrations) is applied to `hms_dev` and `hms_test`: nine identity, settings and audit tables, triggers, and exact `hms_app` grants. Step 4 (seed data and database tests) is done: reference data (settings, 80 permissions, 11 roles, 134 role permissions) is seeded into `hms_dev` and `hms_test`, and 30 database tests pass against `hms_test`. Step 5 is done: every API route is under `/api` (the temporary Vite rewrite is removed), errors share one JSON shape with a request ID, and structured pino logging keeps credentials and patient data out of logs. Step 6 (CI) is added: `.github/workflows/ci.yml` runs on pushes to `phase/day-04-database` and pull requests to `main`. |
| **10-day plan, Day 3: scheduling** | 🚧 In progress on `phase/day-04-database`. **Phase 3A (database) is done:** migrations `0006`–`0008` (doctor schedules, schedule exceptions and appointments; overlap exclusions, the appointment status-machine trigger, `hms_app` grants, cancellation reason required) are applied to `hms_dev` and `hms_test`, with constraint, trigger and concurrent double-booking database tests. No schedules or appointments exist in `hms_dev` yet. **Not started:** Phase 3B (scheduling API: availability, booking, cancel, reschedule, check-in, queues) and Phase 3C (booking and queue UI). See [Scheduling (Day 3)](#scheduling-day-3). |
| **10-day plan, Day 2: patients and doctors** | ✅ Committed as `99dcda3` on `phase/day-04-database`: migrations `0004` and `0005` applied to `hms_test` and `hms_dev` (after a verified `pg_dump` of `hms_dev`); demo data seeded into `hms_dev`; patient search, registration, details and the doctor directory checked in the browser. See [Patients and doctors](#patients-and-doctors). |
| **10-day plan, Day 1: authentication** | ✅ Committed as `6732ecc` (1A) and `2779db2` (1B) on `phase/day-04-database`. **Phase 1A (API):** `sessions` table (migrations `0002`, `0003`, applied to `hms_dev` and `hms_test`), login, logout and `/api/auth/me`, lockout, CSRF, permission middleware, audit library; the first administrator (`admin`) is bootstrapped in `hms_dev`. **Phase 1B (web):** Tailwind CSS, React Router and TanStack Query; login page, session-aware routing, protected app shell and sign-out, all against the real API. Interactive browser login still to be confirmed by the owner. |

**What exists today:**
- Design documentation in `docs/`.
- Root tooling: npm workspaces, TypeScript, ESLint, Prettier and Vitest.
- A local PostgreSQL 17.11 database running in Docker.
- `packages/shared`: role codes shared by API and web. `ROLE_CODES` lists the 11 approved roles (equipment is an INV permission group, not a role), and `permissions.ts`: the 80 permission codes and the role → permission map, checked against `docs/permissions.md`.
- `apps/api`: an Express API with configuration validation, a `GET /api/health` liveness endpoint, request IDs, consistent JSON errors, structured redacted logging, security headers (helmet), and server-side session authentication with permission checks (see [Authentication](#authentication)), plus database tooling in `src/db/`: environment checks, a role bootstrap script and a migration runner, plus the Drizzle schema and migrations `0000`–`0008` (identity, settings, audit, sessions, patients, doctors and the scheduling tables, applied to `hms_dev` and `hms_test`, which are seeded with reference data). Patient and doctor-directory endpoints (see [Patients and doctors](#patients-and-doctors)).
- `apps/web`: a React + TypeScript web app (Vite): login, protected app shell with permission-based navigation, patient search, registration, details and edit, and the doctor directory.
- 227 automated tests in 28 files that need no database (API and web), plus 161 database tests in 9 files (`npm run test:db`) for privileges, the seed, authentication, patients, the bootstrap administrator and the scheduling constraints.

**What doesn't exist yet:** the scheduling API and UI (availability, booking, check-in, queues; the tables exist, the endpoints don't), and every later hospital feature: consultations, pharmacy, billing, lab and dashboards. See the [Roadmap](#roadmap).

---

## Technology stack

| Layer | Choice |
|---|---|
| Frontend | React 19, TypeScript, Vite 8, Tailwind CSS 4, React Router 8, TanStack Query 5, Radix primitives (`radix-ui`) for shadcn-style components written in the repository |
| Backend | Node.js 24, TypeScript, Express, Zod validation |
| Database | PostgreSQL 17.11 with Drizzle ORM 0.45.3 and node-postgres (`pg`). Forward-only migrations in `apps/api/src/db/migrations/`. |
| Testing | Vitest. Playwright for end-to-end tests if time allows. |
| Tooling | npm workspaces, ESLint, Prettier, Docker Compose, GitHub Actions CI (`.github/workflows/ci.yml`) |

The reasons behind each choice are in the [architecture decision records](docs/adr/).

---

## Repository layout

What's in the repository right now:

```
.
├── .github/workflows/ci.yml      CI: a checks job and a database job (fresh PostgreSQL per run)
├── docs/                         Design documentation (see "Design documents")
│   └── adr/                      Architecture decision records 0001–0013
├── apps/
│   ├── api/                      Express API (@hospitalos/api)
│   │   ├── package.json          Scripts: dev, start, typecheck, db:*
│   │   ├── tsconfig.json         Node ESM settings (NodeNext)
│   │   ├── drizzle.config.ts     drizzle-kit settings for `npm run db:generate` (offline; no credentials)
│   │   ├── vitest.config.ts      Unit tests; excludes *.db.test.ts
│   │   ├── vitest.db.config.ts   `npm run test:db`: database tests only, one file at a time
│   │   └── src/
│   │       ├── server.ts         Entry point: validate config → create logger → start listening → shut down cleanly
│   │       ├── app.ts            createApp({ logger }): middleware order and the /api routes
│   │       ├── app.test.ts       Tests for GET /api/health and JSON 404s
│   │       ├── lib/
│   │       │   ├── errors.ts       AppError: an error whose status, code and message are safe to send
│   │       │   ├── logger.ts       createLogger(): pino with redaction and a database-safe error serializer
│   │       │   └── logger.test.ts  Log-capture tests: no credentials, cookies, query strings or patient data
│   │       ├── middleware/
│   │       │   ├── request-id.ts   X-Request-Id: reuse a valid UUID, otherwise generate one
│   │       │   ├── request-log.ts  One allowlisted log line per request
│   │       │   ├── error-handler.ts  JSON 404 and the { error: { code, message, requestId } } handler
│   │       │   └── *.test.ts
│   │       ├── db/
│   │       │   ├── db-env.ts         Database URL guards: each URL must use the expected role and database
│   │       │   ├── check-env.ts      npm run db:env:check: reports each variable as set / missing / invalid
│   │       │   ├── roles-sql.ts      The only SQL db:roles runs (create/alter roles, CONNECT and schema grants)
│   │       │   ├── bootstrap-roles.ts  npm run db:roles: creates hms_owner and hms_app (local only)
│   │       │   ├── migrate.ts        npm run db:migrate[:test]: applies migrations as hms_owner
│   │       │   ├── schema/           Drizzle tables: identity.ts, settings.ts, audit.ts, sessions.ts, patients.ts,
│   │       │   │                     doctors.ts, scheduling.ts, columns.ts (shared helpers)
│   │       │   ├── migrations/       0000–0008: generated tables and hand-written triggers, exclusions and grants,
│   │       │   │                     checksums.json, and meta/ (drizzle-kit's journal and snapshots)
│   │       │   ├── schema.test.ts    Table list, ON DELETE rules, audit columns
│   │       │   ├── migrations.test.ts  Journal order, checksums, forbidden-SQL guard
│   │       │   ├── seed/             seed.ts (reference data), run-seed.ts (npm run db:seed[:test]),
│   │       │   │                     permissions-matrix.test.ts (role map vs docs/permissions.md)
│   │       │   ├── test-db.ts        Database-test helpers: hms_test-only connections, always-rolled-back transactions
│   │       │   ├── *.db.test.ts      Database tests (run with npm run test:db)
│   │       │   └── *.test.ts         Guard tests: wrong targets rejected, no secrets in output, no destructive SQL
│   │       └── config/
│   │           ├── env.ts        Zod schema for environment variables; loadEnv()
│   │           └── env.test.ts   Tests for configuration validation
│   └── web/                      React web app (@hospitalos/web)
│       ├── index.html            HTML page that loads the app
│       ├── vite.config.ts        Dev server (127.0.0.1:5173), /api proxy, test settings
│       ├── tsconfig.json         Browser + JSX settings (bundler resolution)
│       └── src/
│           ├── main.tsx          Entry point: mounts <App /> into #root
│           ├── App.tsx           Landing screen
│           ├── ApiStatus.tsx     "System status" card: checking / online / unreachable + "Check again"
│           ├── api.ts            checkApiHealth(): calls /api/health with a 5-second timeout
│           ├── index.css         Minimal accessible styles
│           ├── test-setup.ts     Cleans up after each test
│           ├── vite-config.test.ts  The /api proxy forwards paths unchanged (no rewrite)
│           └── *.test.ts(x)      Tests for api.ts, ApiStatus and App
├── packages/
│   └── shared/                   Code shared by API and web (@hospitalos/shared)
│       └── src/
│           ├── index.ts          ROLE_CODES (the 11 roles); re-exports permissions.ts
│           ├── permissions.ts    PERMISSIONS, ROLE_NAMES, ROLE_PERMISSIONS: the single source of truth
│           └── index.test.ts
├── docker/
│   └── postgres/init/
│       └── 01-databases.sql      Runs once on a fresh database volume: creates hms_test and extensions
├── docker-compose.yml            Local PostgreSQL 17.11 (digest-pinned, localhost only)
├── vitest.config.ts              Runs each folder in apps/ and packages/ as its own test project
├── .env.example                  Names of the environment variables, placeholders only
├── package.json                  Root npm workspace and scripts
├── package-lock.json             Exact dependency versions
├── tsconfig.base.json            Shared strict TypeScript settings
├── eslint.config.js              ESLint flat config (TypeScript + Prettier compatibility)
├── .prettierrc.json              Prettier formatting rules
├── .prettierignore               Prettier never reformats docs/, this README or drizzle-kit's generated `migrations/meta/`
├── .editorconfig                 Editor defaults (UTF-8, LF, 2-space indent)
├── .nvmrc                        Node version (24)
├── .npmrc                        engine-strict and save-exact
└── .gitignore                    Keeps node_modules, build output and .env out of git
```

**How workspaces connect:** npm links each workspace into `node_modules/@hospitalos/`, so the API can `import { ROLE_CODES } from '@hospitalos/shared'` like any other package. The shared package ships TypeScript source directly, so it has no build step.

---

## Prerequisites

| Tool | Version | Check with |
|---|---|---|
| Node.js | 24.x | `node -v` |
| npm | 11.x | `npm -v` |
| Docker Desktop (or OrbStack) | with Compose v2+ | `docker version` and `docker compose version` |
| Git | any recent | `git --version` |

**Installing Docker Desktop on macOS:**
1. Check your Mac's chip: Apple menu → About This Mac. "Chip: Apple M…" means Apple silicon; "Processor: Intel" means Intel.
2. Download the matching build from <https://docs.docker.com/desktop/setup/install/mac-install/>.
3. Open `Docker.dmg`, drag Docker into Applications, launch it and accept the terms.
4. If `docker` isn't found in Terminal, add Docker's CLI folder to your PATH, then open a new Terminal:
   ```bash
   echo 'export PATH="$PATH:$HOME/.docker/bin"' >> ~/.zprofile
   ```
5. Verify: `docker run --rm hello-world`.

Docker Desktop is free for personal use, education and small businesses. Larger organisations need a paid plan.

---

## Getting started

```bash
# 1. Clone and enter the repository
git clone https://github.com/sairakshith2004/hospital-management-system.git
cd hospital-management-system

# 2. Install dependencies exactly as locked
npm ci

# 3. Create your local .env from the template, with three random passwords:
#    superuser (SU), schema owner (OWNER) and application (APP), and a session secret.
#    They are never printed. .env is git-ignored and must never be committed.
#    SESSION_SECRET, CHANGE_ME_OWNER and CHANGE_ME_APP must be replaced before
#    CHANGE_ME, which is why the sed expressions are in this order.
cp .env.example .env
SU=$(openssl rand -hex 24); OWNER=$(openssl rand -hex 24); APP=$(openssl rand -hex 24)
SESSION=$(openssl rand -hex 32)
sed -i '' -e "s/^SESSION_SECRET=.*/SESSION_SECRET=$SESSION/" \
  -e "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$SU/" \
  -e "s/CHANGE_ME_OWNER/$OWNER/g" -e "s/CHANGE_ME_APP/$APP/g" -e "s/CHANGE_ME/$SU/g" .env   # macOS sed
unset SU OWNER APP SESSION
chmod 600 .env

# 4. Start the database, check the .env, create the least-privilege roles, apply migrations
npm run db:up
npm run db:env:check     # prints each variable as set / missing / invalid, never its value
npm run db:roles         # creates hms_owner and hms_app, limits database access (safe to re-run)
npm run db:migrate && npm run db:migrate:test
npm run db:seed && npm run db:seed:test   # reference data: settings, permissions, roles (safe to re-run)
npm run test:db                           # database tests against hms_test; every test rolls back
npm run db:bootstrap-admin -- --username admin   # first administrator; hidden password prompt, one time only

# 5. Check that everything works
npm run lint && npm run format:check && npm run typecheck && npm test

# 6. Run the API and call its health endpoint
npm run dev:api                      # in one terminal; Ctrl+C stops it
curl -s 127.0.0.1:3000/api/health    # in another: {"status":"ok"}

# 7. Run the web app (in a second terminal, with the API still running)
npm run dev:web                      # then open http://127.0.0.1:5173
```

On Linux, use `sed -i` (without `''`) in step 3.

---

## Running the API

`npm run dev:api` starts the API with `tsx` in watch mode, so it restarts when you save a file. Settings are read from the root `.env` through Node's built-in `--env-file` option; no `dotenv` package is needed.

**How a request is handled today:**
```
.env ──► process.env ──► loadEnv() (config/env.ts) ──► createApp() (app.ts) ──► listen(HOST, PORT)
                              │                                │
                              └─ invalid → print problems,     └─ /api/health, /api/auth/*
                                 exit with code 1

Middleware: helmet → requestId → request log → JSON body (100 KB) → session → loadUser → CSRF
            → /api routes → JSON 404 → error handler
```

**Environment variables:**
| Variable | Required | Default | Rule |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | Must be a `postgres://` or `postgresql://` URL that connects as `hms_app` to `hms_dev`. The API refuses to start if it connects as a superuser. |
| `SESSION_SECRET` | Yes | — | Signs the session cookie. At least 32 characters and not the `.env.example` placeholder; generate with `openssl rand -hex 32`. Never logged. |
| `TRUST_PROXY` | No | `false` | Reverse-proxy hops to trust for the client IP: `false`, `1`, `2` or `3`. `true` is rejected, because it would let any client fake its IP. |
| `PORT` | No | `3000` | Whole number from 1 to 65535 |
| `HOST` | No | `127.0.0.1` | Address to listen on. Localhost by default; a deployed container would set `0.0.0.0`. |
| `NODE_ENV` | No | `development` | `development`, `test` or `production` |
| `LOG_LEVEL` | No | `info` | `fatal`, `error`, `warn`, `info`, `debug` or `silent` |

**If the configuration is wrong,** the API refuses to start and lists every problem. It names the variable and the rule, **never the value**, so a password can't leak into the terminal or logs. For example:
```
Invalid environment configuration:
- PORT: Too big: expected number to be <=65535
- DATABASE_URL: Invalid URL
```

**`GET /api/health`** reports only that the process is running: `200 {"status":"ok"}`. It deliberately exposes no version, environment or configuration details. The Express `X-Powered-By` header is turned off, and JSON request bodies are limited to 100 KB. A database readiness check (`/api/health/ready`) arrives on Day 5, with the API's database connection.

**Errors:** every error response has the same shape, `{"error":{"code":"…","message":"…","requestId":"…"}}`, and every response carries an `X-Request-Id` header with the same ID. Codes so far: `NOT_FOUND` (404, any path without a route), `INVALID_JSON` (400), `UNAUTHENTICATED` and `INVALID_CREDENTIALS` (401), `CSRF_INVALID` and `FORBIDDEN` (403), `PAYLOAD_TOO_LARGE` (413), `UNSUPPORTED_MEDIA_TYPE` (415), `VALIDATION_FAILED` (422, with field paths only, never the submitted values), `RATE_LIMITED` (429) and `INTERNAL_ERROR` (500). The shared TypeScript types are in `packages/shared/src/auth.ts`. Exception messages, stack traces and database details are never sent. A client may send its own `X-Request-Id`; it's used only if it's a well-formed UUID, otherwise a new one is generated.

**Why `app.ts` and `server.ts` are separate:** `createApp()` only builds the app; `server.ts` starts it. Tests use the app directly through `supertest` without opening a network port, and future middleware (security headers, sessions, CSRF) is added in one place.

**Logging:** JSON lines via pino.
- One line per request with only the request ID, method, path **without its query string**, status and duration. Bodies, headers, cookies and query strings are never logged.
- Unexpected errors are logged with their type, message and stack; database errors without their message or values (only code, table, column and constraint).
- Credential, connection-string and personal-data keys are redacted as a backstop.
- The startup line shows only host, port and environment.
- `LOG_LEVEL` sets the level. `lib/logger.test.ts` enforces all of this (groundwork for SE-5).

### Authentication

Server-side sessions stored in PostgreSQL ([ADR 0004](docs/adr/0004-session-authentication.md)); no tokens in browser storage.

| Endpoint | Request | Response |
|---|---|---|
| `POST /api/auth/login` | JSON `{ "username", "password" }` (rate-limited) | `200 { user, csrfToken }` and the session cookie; any failure is `401 INVALID_CREDENTIALS` |
| `GET /api/auth/me` | session cookie | `200 { user, csrfToken }` or `401 UNAUTHENTICATED` |
| `POST /api/auth/logout` | session cookie and `X-CSRF-Token` | `204`, session deleted and cookie cleared |

`user` is `{ id, username, fullName, roles, permissions }`; permissions are re-read from the database on every request, so a role change or deactivation applies immediately.

- **Passwords:** argon2id (19 MiB, 2 passes). Unknown usernames are checked against a dummy hash so timing doesn't reveal which accounts exist.
- **Every login failure looks the same** (`401 INVALID_CREDENTIALS`). The real reason (`unknown_user`, `inactive`, `locked`, `bad_password`) goes only into the audit log, and the attempted username of an unknown account is never stored.
- **Lockout:** 5 consecutive wrong passwords lock the account for 15 minutes. **Rate limit:** 10 failed attempts per IP per 15 minutes, then `429 RATE_LIMITED` with `Retry-After`.
- **Sessions:** cookie `hms.sid` (`__Host-hms.sid` in production), `httpOnly`, `SameSite=Lax`, `Secure` in production. 30 minutes idle (rolling) and 12 hours absolute from login. A new session ID is issued at login (prevents session fixation); logout deletes the session row. Sessions of disabled users are ended on their next request.
- **No caching:** every API response is sent with `Cache-Control: no-store` and without an ETag, so the browser never stores user details or the CSRF token.
- **CSRF:** every `POST`, `PUT`, `PATCH` and `DELETE` from a signed-in session must send the `X-CSRF-Token` header with the token from the login or `/me` response (keep it in memory, never in `localStorage`). Login itself must be JSON, which a cross-site form can't send.
- **Permissions:** routes use `requirePermission(db, 'code')` with the codes from `packages/shared`. Without a session: `401`. Without the permission: `403 FORBIDDEN` and an `access.denied` audit row.
- **Audit:** `auth.login_succeeded`, `auth.login_failed`, `auth.locked`, `auth.logout`, `access.denied`, `user.created`. Audit rows never contain passwords, hashes, session IDs, cookies or CSRF tokens (`lib/audit.ts` refuses such keys).

### Patients and doctors

| Endpoint | Permission | Notes |
|---|---|---|
| `GET /api/patients?q=` | `patient:read_demographics` | At least 2 characters. Matches an MRN exactly, phone digits partially, or a name partially or fuzzily (trigram index). Up to 20 results. |
| `GET /api/patients/:id` | `patient:read_demographics` | 404 for unknown or malformed IDs |
| `POST /api/patients` | `patient:create` | 201 with the generated MRN. `409 DUPLICATE_SUSPECTED` (with the matching patients' MRN and name) when the phone and date of birth match an existing patient, unless the body has `confirmDuplicate: true`. Audited as `patient.created`. |
| `PATCH /api/patients/:id` | `patient:update_demographics` | Send the `version` you read; a newer version gives `409 STALE_VERSION`. Audited as `patient.updated` with the changed field **names** only. |
| `GET /api/doctors?departmentId=` | `schedule:read` | Active doctors with department, specialty, slot length and consultation fee (paise) |
| `GET /api/departments` | signed in | Active departments |

- **MRNs** (`MRN000001`…) come from a database sequence, so concurrent registrations never share one; the sequence stops at 999999 rather than ever repeating.
- **Duplicates:** registrations for the same phone and date of birth take a transaction-scoped lock, so two simultaneous registrations of one person can't both slip past the check.
- **Validation:** the same Zod schemas (`packages/shared/src/schemas/patients.ts`) run in the API (authoritative) and in the web forms. "Today" means today in the hospital time zone (Asia/Kolkata).
- **Never deleted:** `hms_app` has no DELETE on patients or doctor profiles.

**Demo data:** `npm run db:seed:demo` adds synthetic data to `hms_dev` only: 10 departments, staff with one account per role (`rec1`, `nur1`, `pha1`, `lab1`, `fin1`, `adm1`, `hr1`, `inv1`, `mkt1`, `doc1`–`doc6`), 6 doctor profiles and 40 patients (phones `90000xxxxx`). It asks once, at a hidden prompt, for the password of the new demo accounts and stores only its hash. It refuses in production or without an interactive terminal, never changes existing rows (so it never resets a password), and is safe to re-run.

**First administrator:** `npm run db:bootstrap-admin -- --username <name>` creates one Super Admin (SA) in `hms_dev`, as `hms_app`. You type the password twice at a hidden prompt (12–256 characters); it is never an argument, never read from a pipe, never printed, and only its hash is stored. It refuses in production, without an interactive terminal, and whenever any SA account already exists, so it can never reset or duplicate an administrator. Recovering a lost administrator is a manual, superuser-only procedure and is deliberately not scripted.

---

## Running the web app

Use two terminals: `npm run dev:api` in the first and `npm run dev:web` in the second (the database must be running). Then open **http://127.0.0.1:5173** and sign in with a staff account, such as the administrator created by `npm run db:bootstrap-admin`.

**What you'll see:**
- **Signed out:** the sign-in page (username, password), with a live API-status line.
- **Signed in:** the app shell: the hospital name, your name and roles, a **Sign out** button, a navigation sidebar showing only what your permissions allow (just *Home* until the modules arrive), and a home page that welcomes you. An account without roles is told it is waiting for a role assignment.
- Unknown paths show a "Page not found" page inside the shell; `/forbidden` is the "no access" page used when the API answers 403.

**How sign-in works in the browser:**
- **Startup:** the app calls `GET /api/auth/me`. With a valid session cookie it opens the page you asked for; otherwise it shows `/login?next=<that page>`. If the API can't be reached, it shows "Can't reach the server" with **Try again** instead of signing you out.
- **Sign in:** `POST /api/auth/login` with JSON. Failures show only "Invalid username or password." (or "Too many attempts. Try again in a few minutes." on 429), and the password field is cleared. After success you go to `next`, which must be a path inside the app; anything else (for example `//evil.example`) goes to `/`.
- **CSRF token:** taken from the login and `/me` responses and kept **only in memory** (`src/lib/api.ts`). Every `POST`, `PUT`, `PATCH` and `DELETE` sends it as `X-CSRF-Token`; `GET` never does. A page reload fetches it again from `/me`.
- **Sign out:** `POST /api/auth/logout` with the token; all cached data is dropped and you land on `/login?signedOut=1`.
- **Session ended by the server** (30 minutes idle, 12 hours absolute, account disabled): the next API call gets 401, the app forgets the session and token, and sends you to `/login?expired=1&next=…` with "Your session has ended. Please sign in again."
- Route guards and permission-based navigation only shape the screen; **the API checks authentication and permissions on every request.**

**Where things live (`apps/web/src/`):**
| Path | Responsibility |
|---|---|
| `lib/api.ts` | The only way to call the API: same-origin JSON, CSRF header on writes, `ApiError` for the API's error shape, session-expiry signal; plus `checkApiHealth` |
| `lib/query-client.ts`, `lib/utils.ts` | TanStack Query defaults (no retries on 4xx); `cn()` class helper |
| `features/auth/` | `AuthProvider` (session state, login, logout, `can()`), `RequireAuth` (route guard), `LoginPage`, `safeNext` |
| `app/` | `AppShell`, `HomePage`, `ForbiddenPage`, `NotFoundPage`, and `navigation.ts` (menu items with the permission each needs) |
| `components/ui/` | Hand-written shadcn-style `Button`, `Input`, `Label`, `Card`, `Alert`, `Spinner` |
| `App.tsx`, `main.tsx` | Route table and providers |

**How the browser reaches the API (the Vite proxy):**
```
Browser ──/api/…──► Vite dev server (127.0.0.1:5173) ──/api/… (unchanged)──► API (127.0.0.1:3000)
```
The browser only talks to one origin, so the session cookie is first-party and the API needs **no CORS configuration**. Use `127.0.0.1` consistently: `localhost` keeps a separate cookie. `vite-config.test.ts` fails if a path rewrite is ever added back.

**Security:** the session cookie is `httpOnly` (JavaScript can't read it) and the app never touches `document.cookie`, `localStorage` or `sessionStorage`. The web app reads no environment variables, so no secret can reach the browser bundle. Both dev servers listen on `127.0.0.1` only.

**Accessibility:** every field has a label; errors are announced (`role="alert"`) and notices politely (`role="status"`); status is always written in words, not colour alone; keyboard focus is clearly visible; light and dark themes follow the operating system.

**Production build:** `npm run build` writes static files to `apps/web/dist/` (git-ignored). `npm run preview -w @hospitalos/web` serves them at `http://127.0.0.1:4173` without the `/api` proxy, so sign-in doesn't work there until deployment routing is set up.

---

## Local database

| Item | Value |
|---|---|
| Image | `postgres:17.11-bookworm`, **pinned by digest** `sha256:3645570cccdfa447589da9f57dd740faa29b30938e861289a5574b6ca6b03826` |
| Address | `127.0.0.1:5432`. It listens only on localhost, never on your network. |
| Databases | `hms_dev` (development) and `hms_test` (automated tests) |
| Extensions | `pgcrypto`, `citext`, `pg_trgm`, `btree_gist`, in both databases |
| Credentials | Read from `.env` (`POSTGRES_USER`, `POSTGRES_PASSWORD`). Compose refuses to start if either is missing. |
| Data | Kept in the Docker volume `hospitalos_hms_pgdata`, which survives restarts |
| Restart policy | Starts automatically whenever Docker Desktop starts |
| Health check | `pg_isready` every 5 seconds |

**Why pin by digest?** A tag such as `17.11-bookworm` can be re-pointed upstream; a digest can't, so everyone runs byte-identical images. The Debian `bookworm` variant is fixed because changing the operating system's text library (glibc) can change sort order and invalidate indexes.

**Useful commands:**
```bash
npm run db:up                  # start and wait until healthy
npm run db:down                # stop (data is kept)
npm run db:psql                # open psql on hms_dev
docker compose ps              # status; should show "(healthy)"
docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d hms_dev -Atc "show server_version"'
```

**How the init script works:** `docker/postgres/init/01-databases.sql` runs **only once**, when the data volume is empty. On later starts Postgres skips it, even if you edit it. To run it again you must delete the volume with `docker compose down -v`, which **permanently deletes all local data**. Lasting schema changes therefore belong in migrations (from Day 4), never in this script.

### Database roles

Each job uses its own PostgreSQL role, so development, test, migration and application access stay separate.

| Role | Used by | Variables | Can do |
|---|---|---|---|
| `hms` (`POSTGRES_USER`) | `npm run db:roles` only | `ADMIN_DATABASE_URL` (must be `127.0.0.1` or `localhost`, database `hms_dev`) | Container superuser, local development only. The API and migrations never use it. |
| `hms_owner` | Migrations | `MIGRATION_DATABASE_URL` (`hms_dev`), `TEST_MIGRATION_DATABASE_URL` (`hms_test`) | Owns the schema: creates tables and functions. `CONNECT` and `CREATE` on both databases (`CREATE` lets it make Drizzle's `drizzle` schema); `USAGE` and `CREATE` on schema `public`. No `TEMPORARY`. Not a superuser; can't create databases or roles. |
| `hms_app` | The API and database tests | `DATABASE_URL` (`hms_dev`), `TEST_DATABASE_URL` (`hms_test`) | Reads and writes data only: `CONNECT` on both databases and `USAGE` on schema `public`; it can't create tables, schemas, temporary tables, roles or databases. Table grants come from migrations (Step 3): no `DELETE` on clinical, financial or audit tables, and `audit_logs` is INSERT-only. |

**Safeguards:**
- Every db script checks that each URL connects as the **expected role to the expected database** before connecting. A migration URL that points at the wrong database, or a superuser URL used for the app, is refused.
- Errors and output name the variable and the rule, or print `role@host:port/database`, **never a password or connection string**.
- `db:roles` refuses to run when `NODE_ENV=production`, when the admin URL isn't local, when it isn't a superuser, or when `hms_dev`/`hms_test` don't exist. The superuser check comes first, so a wrong URL gets a clear message.
- It only creates or alters the two roles and sets database and schema access. It never drops, truncates or deletes anything and never creates a database. Its one `REVOKE` removes PostgreSQL's default `CONNECT` and `TEMPORARY` for `PUBLIC` (every role) on `hms_dev` and `hms_test`, so only `hms_owner`, `hms_app` and the superuser can connect there. A test (`roles-sql.test.ts`) enforces all of this and rejects any other `REVOKE`.
- Passwords are passed as query parameters, never written into SQL text, and statement logging is turned off for its sessions. If setting a role up fails, PostgreSQL reports only the role name and an error code, so the password can't end up in an error message or the server log.
- Roles are created with `NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`.
- One PostgreSQL role serves both databases, so the dev and test URLs for a role must share the same password; `db:roles` checks this.

**Migration rules:**
- Migrations live in `apps/api/src/db/migrations/` and are **forward-only**. Never edit or delete a migration that has been applied; write a new one.
- `drizzle-kit push` and `drizzle-kit drop` are never used.
- `db:migrate` applies all pending migrations in one transaction as `hms_owner`, records them in `drizzle.__drizzle_migrations`, and holds a PostgreSQL advisory lock so two runs can't overlap. It prints only the target (`role@host:port/database`) and how many migrations were applied.

### Database schema (Day 4)

Nine tables, created by migration `0000` and owned by `hms_owner`:

| Table | Holds |
|---|---|
| `hospital_settings` | One row of configurable policy (care windows, discount limit, day-close time…) |
| `departments`, `employees` | Organisation; every staff member is an employee (`full_name`; status `active`, `on_leave` or `exited`) |
| `users` | At most one login per employee (`username` is case-insensitive; status `active` or `disabled`; lockout via `failed_logins` and `locked_until`) |
| `roles`, `permissions`, `user_roles`, `role_permissions` | Role-based access: a user's permissions are the union of their roles' permissions |
| `audit_logs` | Append-only record of sensitive actions |

Every foreign key is `ON DELETE RESTRICT`, except the four assignment keys in `user_roles` and `role_permissions`, which cascade. Nothing else is ever deleted.

**`hms_app` privileges** (migration `0001`): SELECT, INSERT and UPDATE on departments, employees, users and roles; SELECT and UPDATE on `hospital_settings`; SELECT on `permissions`; SELECT, INSERT and DELETE on `user_roles` and `role_permissions` (revoking an assignment deletes its row); SELECT and INSERT on `audit_logs`. No TRUNCATE, REFERENCES or TRIGGER anywhere, and future tables get nothing until a migration grants it.

**How `audit_logs` stays append-only:**
1. `hms_app` has no UPDATE, DELETE or TRUNCATE privilege on it.
2. Triggers reject UPDATE, DELETE and TRUNCATE for every role, including the owner.
3. `hms_app` doesn't own the table, so it can't disable the triggers or alter the table.
4. No migration may contain `DISABLE TRIGGER`, `session_replication_role` or `DROP` (enforced by a test).

Limits: the table owner (`hms_owner`, used only for reviewed migrations) or a superuser could still deliberately remove the protection. `audit_logs.id` is generated by PostgreSQL; the audit library never supplies it, although PostgreSQL would accept `OVERRIDING SYSTEM VALUE` from any role with INSERT.

### Scheduling (Day 3)

Phase 3A added three tables (migration `0006`, generated) and the rules Drizzle can't express (migration `0007`, hand-written), plus one stricter check (`0008`). The API and UI for them are not built yet (Phase 3B and 3C).

| Table | Holds |
|---|---|
| `doctor_schedules` | Weekly sessions per doctor: ISO weekday, start and end time, slot length (5–120 minutes), validity dates, `active` |
| `schedule_exceptions` | Leave or blocked periods per doctor (`starts_at`–`ends_at`, optional reason) |
| `appointments` | Number `APT0000001…` from `appointment_no_seq`; kind `scheduled`, `walk_in` or `follow_up`; status; visit date and slot (walk-ins have no slot); per-doctor, per-day `token_no`; status timestamps; cancel reason; links to the appointment it was rescheduled from or follows up (same patient only) |

**Rules enforced by PostgreSQL:**
- No double booking: GiST exclusion constraints stop two active appointments (`booked`, `checked_in`, `in_consultation`) of the same doctor, or of the same patient, from overlapping in time. A concurrent second booking waits, then fails (`23P01`).
- A doctor's active weekly sessions on the same weekday can't overlap while their validity periods overlap.
- One active appointment per patient, doctor and day; tokens are unique per doctor and day (`appointments_doctor_day_token_key`).
- The status machine from [`docs/state-machines.md`](docs/state-machines.md) §1 is enforced by a trigger: new rows start as `booked` or `checked_in`, only allowed transitions pass, and patient, doctor, number and kind never change. The same table is in `packages/shared/src/schemas/appointments.ts`.
- Checks on slot shape (walk-ins have none, start before end, slot on the visit date in Asia/Kolkata), status timestamps, and a non-blank cancellation reason (`0008`).
- `hms_app` has SELECT, INSERT and UPDATE on the three tables (no DELETE: history is kept) and USAGE on `appointment_no_seq`.

**Adding a migration:**
1. Change the schema in `apps/api/src/db/schema/`, then run `npm run db:generate -- --name=<short_name>`. It works offline and writes the next numbered SQL file. For hand-written SQL (triggers, grants), use `npm run db:generate -- --custom --name=<short_name>` and fill in the empty file.
2. Review the SQL. `npm test` rejects destructive or privilege-widening statements.
3. Add the file's SHA-256 to `migrations/checksums.json` (`shasum -a 256 <file>`). `npm test` fails until you do, and fails again if an existing migration is ever edited.
4. Apply it with `npm run db:migrate`, then `npm run db:migrate:test`.

### Seed data

`npm run db:seed` (`hms_dev`) and `npm run db:seed:test` (`hms_test`) load the reference data that authorization depends on, as `hms_owner`, in one transaction. All of it is synthetic.

| Data | Source | If it already exists |
|---|---|---|
| The `hospital_settings` row ("HospitalOS Demo Hospital", ERD defaults) | `seed.ts` | Left alone; settings changed later are never overwritten |
| 80 permissions | `packages/shared/src/permissions.ts` | Description refreshed |
| 11 system roles | `ROLE_NAMES` | Name refreshed |
| 134 role permissions | `ROLE_PERMISSIONS` (● and ◐ cells of the matrix; ◐ conditions are enforced by services) | Missing ones added |

- It never deletes anything. If a system role holds a permission the code doesn't grant, or the database has an unknown permission code, the seed stops, names the difference and changes nothing.
- A run that changes something writes one `audit_logs` row (`actor_type = system`, `action = seed.applied`, counts only). A run that changes nothing writes none.
- It prints counts and the target (`role@host:port/database`) only.
- `permissions-matrix.test.ts` fails if `ROLE_PERMISSIONS` stops matching the matrix in `docs/permissions.md`.
- Departments and the bootstrap Super Admin come on Day 5 with login.

### Database tests

`npm run test:db` runs the `*.db.test.ts` files against `hms_test`. `npm test` skips them, so it never needs a database.

- Connections use the same URL guards as the scripts, so they can only reach `hms_test`, as `hms_app` or `hms_owner`. `TEST_DATABASE_URL` and `TEST_MIGRATION_DATABASE_URL` must also point at `127.0.0.1` or `localhost` on an explicit port `5432`, with no query parameters (an omitted port would let `PGPORT` decide, and `?host=` would override the host). A development or remote URL is refused before any connection opens, and the error names only the variable and the rule. The same rules apply to `db:migrate:test`, `db:seed:test` and `db:env:check`.
- Every test runs inside a transaction that's always rolled back. The only lasting effect is that `audit_logs_id_seq` advances, so audit ids in `hms_test` have gaps.
- They check:
  - the applied migrations match `checksums.json`
  - the exact `hms_app` privilege matrix
  - `hms_app` can't DELETE except on the two join tables
  - `hms_app` can insert audit rows but can't update, delete, truncate or use the id sequence directly
  - the append-only triggers stop even the table owner
  - `set_updated_at`, key constraints, and the seed's behaviour (idempotency, drift detection, settings never overwritten)
- "Migrations apply to an empty database" is shown by the first `db:migrate:test` onto the empty `hms_test`. CI (Day 5) will repeat it on a fresh container every run.

**Preflight before `npm run db:roles`:** make sure the only thing listening on `127.0.0.1:5432` is this project's Docker container, so the role setup can't reach a different PostgreSQL. Neither command connects to the database.
```bash
docker compose ps db                          # STATUS shows "(healthy)", PORTS shows 127.0.0.1:5432->5432/tcp
lsof -nP -iTCP:5432 -sTCP:LISTEN              # only Docker's process (com.docker… or OrbStack), only on 127.0.0.1
```

See [ADR 0006](docs/adr/0006-postgresql-docker.md).

---

## npm scripts

Run these from the repository root.

| Script | What it does |
|---|---|
| `npm run lint` | ESLint over the whole repository |
| `npm run format` | Prettier: rewrites files to the project style |
| `npm run format:check` | Prettier: checks only, changes nothing (used in CI) |
| `npm run typecheck` | Type-checks every workspace that has a `typecheck` script |
| `npm test` | Runs all Vitest tests (currently 227, in 28 files). Web tests run in a simulated browser (jsdom). No database or running server is needed. Database tests are excluded; see `npm run test:db`. |
| `npm run dev:api` | Starts the API in watch mode at `http://127.0.0.1:3000` |
| `npm run dev:web` | Starts the web app at `http://127.0.0.1:5173`, forwarding `/api/*` to the API |
| `npm run build` | Builds every workspace that has a `build` script; today that's the web app, into `apps/web/dist/` |
| `npm run db:up` | Starts PostgreSQL and waits until it's healthy |
| `npm run db:down` | Stops PostgreSQL (keeps data) |
| `npm run db:psql` | Opens `psql` on `hms_dev` inside the container |
| `npm run db:env:check` | Reports each database variable in `.env` as set, missing or invalid. Never prints values. |
| `npm run db:roles` | Creates or updates the `hms_owner` and `hms_app` roles, removes the default `PUBLIC` access to `hms_dev`/`hms_test`, and grants the two roles their connect/schema access. Local only; safe to re-run. Run the preflight check in "Database roles" first. |
| `npm run db:migrate` | Applies pending migrations to `hms_dev` as `hms_owner` |
| `npm run db:migrate:test` | Applies pending migrations to `hms_test` as `hms_owner` |
| `npm run db:generate` | Generates the next migration from the schema (offline; never connects). Add `-- --custom --name=…` for hand-written SQL |
| `npm run db:seed` | Seeds reference data into `hms_dev` as `hms_owner` (settings, permissions, roles, role permissions). Safe to re-run |
| `npm run db:seed:test` | The same for `hms_test` |
| `npm run db:seed:demo` | Adds synthetic demo departments, staff accounts, doctors and patients to `hms_dev` (hidden password prompt; never changes existing rows) |
| `npm run db:bootstrap-admin -- --username <name>` | Creates the first Super Admin in `hms_dev` with a hidden password prompt. Refuses if any administrator exists, in production, or without an interactive terminal |
| `npm run test:db` | Runs the database tests against `hms_test` (rolled back; needs `.env` and the running database). Vitest options pass through, e.g. `npm run test:db -- --reporter=verbose` |

---

## Code quality tooling

| Tool | Version | Configuration |
|---|---|---|
| TypeScript | 6.0.3 | `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, target ES2023 |
| ESLint | 10.12.0 | `eslint.config.js`: `defineConfig` with recommended JS and TypeScript rules; Prettier-compatible |
| typescript-eslint | 8.71.2 | Used through ESLint's `defineConfig` (the older `tseslint.config()` helper is deprecated) |
| Prettier | 3.9.10 | `.prettierrc.json`: single quotes, trailing commas, 100-character lines |
| Vitest | 5.0.4 | Test runner for every workspace |

`.npmrc` sets `save-exact=true`, so every dependency is pinned to an exact version, and `engine-strict=true`, so npm refuses to run on an unsupported Node version.

**API dependencies (`apps/api`):**
| Package | Version | Kind | Purpose |
|---|---|---|---|
| express | 5.3.0 | runtime | HTTP server and routing |
| zod | 4.6.7 | runtime | Validates configuration (and, from Day 4, requests) |
| pino | 10.3.1 | runtime | Structured JSON logging with redaction |
| drizzle-orm | 0.45.3 | runtime | Typed SQL queries and the migration runner |
| pg | 8.23.1 | runtime | PostgreSQL driver (node-postgres) |
| drizzle-kit | 0.31.11 | dev | Generates SQL migrations from the schema. `push` and `drop` are never used. |
| tsx | 4.23.15 | dev | Runs TypeScript directly, with watch mode |
| supertest | 7.3.1 | dev | Calls the Express app in tests without a network port |
| @types/express, @types/node, @types/pg, @types/supertest | 5.0.6, 26.6.5, 8.23.1, 7.2.1 | dev | Type definitions |

**Web app dependencies (`apps/web`):**
| Package | Version | Kind | Purpose |
|---|---|---|---|
| react, react-dom | 19.3.1 | runtime | User-interface library |
| vite | 8.3.4 | dev | Dev server, `/api` proxy and production build. It's the same copy Vitest already uses. |
| @vitejs/plugin-react | 6.1.2 | dev | JSX and fast refresh for Vite |
| @testing-library/react, @testing-library/dom | 16.3.3, 10.4.2 | dev | Render components in tests and query them the way users do (by role and text) |
| jsdom | 30.1.2 | dev | Simulated browser for tests |
| @types/react, @types/react-dom | 19.3.0 | dev | Type definitions |

**Root linting addition:** `eslint-plugin-react-hooks` 7.1.1, with its recommended rules applied to `apps/web` only. It catches mistakes such as calling hooks conditionally or missing effect dependencies.

`packages/shared` has no dependencies yet.

**Blocked install scripts:** npm 11 doesn't run packages' install scripts unless they're approved.
- **What's blocked:** `esbuild`'s `postinstall` (`node install.js`), for the copy used by `tsx` and Vite and for the older copies drizzle-kit brings in, and `fsevents` (an optional macOS file-watching package). esbuild is used by `tsx`, by Vite inside Vitest and by drizzle-kit.
- **Nothing is broken by this.** esbuild's binary for your platform (for example `@esbuild/darwin-arm64`) is installed as a separate optional package. The API starts and all tests pass without the script.
- **What the script would do:** download the binary if that package were missing, and slightly speed up the command-line tool's startup.
- **What to do if it ever fails** (for example if optional dependencies were skipped): approve only esbuild with `npm install-scripts approve esbuild`, never all scripts.
- `npm install-scripts ls` shows the current list.

**Known `npm audit` findings:** 4 moderate, all in development tooling. drizzle-kit 0.31.11 depends on `@esbuild-kit/esm-loader`, which pulls in `esbuild` 0.18.20 (GHSA-67mh-4wv8-2f99: esbuild's development server accepts cross-origin requests). drizzle-kit never starts that server, and none of it ships with the API. Don't run `npm audit fix --force`: it would install an incompatible drizzle-kit. We'll upgrade when a drizzle-kit release drops the old dependency.

### Continuous integration

`.github/workflows/ci.yml` runs on every push to `phase/day-04-database` and on every pull request into `main`. It has two jobs that run in parallel on `ubuntu-24.04`:

| Job | Runs |
|---|---|
| **checks** | `npm ci`, lint, format check, typecheck, `npm test`, build, and `npm audit --audit-level=high` (fails on high or critical findings; never changes dependencies) |
| **database** | Starts a **fresh, disposable PostgreSQL** on the runner with `docker compose` (the same digest-pinned image and init script as local), then `db:env:check`, `db:roles`, `db:migrate:test` (proving migrations apply to an empty database, then that a re-run applies nothing), `db:seed:test` twice (the second run must change nothing) and `npm run test:db` |

- CI never connects to a developer's database and needs no repository secrets. It builds its own `.env` from `.env.example` with random throwaway passwords, which are masked in the logs.
- The workflow only reads the repository (`permissions: contents: read`), and the checkout doesn't keep credentials.
- Actions are pinned to full commit SHAs with the version in a comment. To update one, pick a release at least 14 days old, resolve its commit with `git ls-remote --tags https://github.com/<owner>/<repo> refs/tags/<tag> 'refs/tags/<tag>^{}'` (the `^{}` line, if present, is the commit for an annotated tag), then update both the SHA and the comment.

---

## Security practices

- **Secrets live only in `.env`.** It's git-ignored, readable only by you (`chmod 600`), and never printed. `.env.example` holds names and placeholders only.
- **The database listens only on localhost.**
- **Docker images are pinned by digest**, and npm dependencies by exact version via the lockfile.
- **Authentication and authorization are always checked on the server:** PostgreSQL-backed sessions, argon2id passwords, lockout, rate-limited login, CSRF tokens, and a permission check on every protected route. The UI never decides who may see what. See [`docs/permissions.md`](docs/permissions.md).
- **Clinical and financial records are never hard-deleted**, and sensitive actions are audited. See [ADR 0011](docs/adr/0011-corrections-audit-no-hard-deletes.md).

---

## Git workflow

- `main` holds reviewed, merged work only.
- Each phase is developed on its own branch (for example `phase/day-03-foundation`) and merged into `main` through a pull request.
- Every step is reviewed before it's committed, and pushes happen only after explicit approval.
- Exception: on 2026-10-15 the first Day 3 commits were pushed **directly to `main`** at the owner's request, without a pull request.
- `.env` (secrets) and `node_modules/` are never pushed.

---

## Design documents

| Document | What it covers |
|---|---|
| [`docs/requirements.md`](docs/requirements.md) | Scope, functional requirements per role, approved safeguards and scope clarifications, 121 acceptance criteria |
| [`docs/architecture.md`](docs/architecture.md) | System shape, module rules, conventions, end-of-day job, frontend styling plan |
| [`docs/erd.md`](docs/erd.md) | Every table, key, constraint and index; transaction boundaries; the dispensing algorithm |
| [`docs/permissions.md`](docs/permissions.md) | The 11-role permission matrix (including per-operation, per-location stock permissions, split settings permissions and Super Admin limits), patient-data access rules, emergency access, audit rules |
| [`docs/state-machines.md`](docs/state-machines.md) | Lifecycles for appointments, encounters, prescriptions, invoices and more |
| [`docs/roadmap.md`](docs/roadmap.md) | The 10-day MVP plan (from 2026-10-17), scope matrix and definition of done |
| [`docs/adr/`](docs/adr/) | 13 architecture decision records |

---

## Roadmap

The 30-day plan was replaced on 2026-10-17 by a **10-day MVP plan**: [`docs/roadmap.md`](docs/roadmap.md). Day 1 (authentication) and Day 2 (patients and doctors) are done. Day 3 (scheduling) is in progress: the database part (Phase 3A) is done; the API (3B) and UI (3C) are next.

---

## Change log

| Commit | Summary |
|---|---|
| `c870a62` | Initial commit |
| `4320c99` | Day 2 design documentation (merged to `main` as `ab7388a`, PR #1) |
| `a08d322` | Day 3 safeguards: nurse session assignments, return checklist, pinned Postgres, styling plan |
| `ae58fc1` | Root workspace tooling: TypeScript, ESLint, Prettier, Vitest |
| `3e6d3a1` | Local PostgreSQL 17.11 via Docker Compose, digest-pinned |
| `0110c51` | README rewritten to document how the project works; kept up to date from now on. Pushed directly to `main` with the Day 3 commits above. |
| `b275c21` | Shared package (role codes) and API skeleton: configuration validation, `GET /health`, 11 tests (merged to `main` as `26311c0`, PR #2) |
| `10915fd` | Minimal React + TypeScript web app: landing screen, API-status indicator, `/api` dev proxy (temporary rewrite), React Hooks lint rules, 9 more tests (merged to `main` as `8850ce4`, PR #3) |
| `61d30d2` | Scope clarifications C1 to C4: separate stock permissions per operation and location (pharmacy and store adjustments, supplier goods receipts, transfer receipts, dispensing); only Super Admin assigns roles and nobody changes their own; system and security settings split from operational settings; audit viewer limits and immutability. Also: exactly 11 roles (equipment and maintenance becomes an INV permission group), source-based transfer dispatch with explicit acceptance or rejection by a different user and audited returns, the no-role onboarding rule, and a Day 7 rebalance. Documentation only; adds acceptance criteria ST-1 to ST-12 and AD-1 to AD-8, and a test-milestone table in the roadmap (merged to `main` as `17674f6`, PR #4). |
| `2e2ab29` *(on `phase/day-04-database`, not pushed)* | Day 4 Step 1: `ROLE_CODES` reconciled to the 11 approved roles (`EQP` removed); its test now checks the exact list. |
| `4acbfde` *(on `phase/day-04-database`, not pushed)* | Day 4 Step 2a: drizzle-orm, pg and drizzle-kit installed; database URL guards, `db:env:check`, `db:roles` and `db:migrate` scripts with separate superuser, owner and application roles; `.env.example` with the five database URLs; 17 more tests. Step 2b: role setup hardened (PUBLIC `CONNECT`/`TEMPORARY` removed on both databases, password-safe error handling, superuser check first), local `.env` updated, and `db:roles` run: roles created and verified. |
| `5eb7e33` *(on `phase/day-04-database`, not pushed)* | Day 4 Step 3: Drizzle schema for nine identity, settings and audit tables; migration `0000` (generated) and `0001` (hand-written `updated_at` and append-only audit triggers, and exact `hms_app` grants), applied to `hms_dev` and `hms_test`; migration checksums and a forbidden-SQL guard (including `DISABLE TRIGGER` and `session_replication_role`); `npm run db:generate`; 22 more tests. |
| `1a483db` *(on `phase/day-04-database`, not pushed)* | Day 4 Step 4: `packages/shared/src/permissions.ts` (80 permission codes, 11 role names, the role → permission map) with a test against `docs/permissions.md`; an idempotent, never-deleting reference-data seed (`db:seed`, `db:seed:test`) with drift detection and a system audit row; 30 rolled-back database tests (`test:db`), including the audit-log INSERT and append-only trigger checks; seeded into `hms_dev` and `hms_test`. 4 more unit tests. |
| `790a55c` *(on `phase/day-04-database`, not pushed)* | Database-test harness: the test URLs must be `127.0.0.1` or `localhost` on port 5432 with no query parameters (also applies to `db:migrate:test`, `db:seed:test` and `db:env:check`); root `npm run test:db` forwards Vitest options. 9 more unit tests. |
| `973b62f` *(on `phase/day-04-database`)* | Day 4 Step 5: every API route under `/api` (`GET /api/health`), and the temporary Vite rewrite removed; JSON 404s and one error shape `{ error: { code, message, requestId } }` with no internals exposed; `X-Request-Id` (reuses a valid UUID, otherwise generates one); pino 10.3.1 structured logging with an allowlisted request line, a database-safe error serializer and redaction; optional `LOG_LEVEL`. Smoke-checked live, directly and through the Vite proxy. 27 more tests. |
| `09fb7b9` *(on `phase/day-04-database`)* | Day 4 Step 6: GitHub Actions CI (`.github/workflows/ci.yml`): a checks job (lint, format, types, unit tests, build, `npm audit --audit-level=high`) and a database job on a fresh, disposable PostgreSQL (roles, migrations applied to an empty database and re-run, seed and re-run, database tests). Triggers: pushes to `phase/day-04-database` and pull requests to `main`; read-only permissions; actions pinned by commit SHA; no repository secrets. |
| `6732ecc` *(on `phase/day-04-database`)* | 10-day plan, Day 1, Phase 1A: auth packages (express-session 1.19.0, connect-pg-simple 10.0.0, @node-rs/argon2 2.2.1, helmet 8.3.0, express-rate-limit 8.7.0, with `ip-address` pinned to 10.7.2); `sessions` table and `hms_app` grant (migrations `0002`, `0003`); login, logout and `/api/auth/me`; lockout, rate limiting, CSRF, `requireAuth` and `requirePermission`; audit library; bootstrap administrator; `SESSION_SECRET` and `TRUST_PROXY` validation; helmet; the 10-day roadmap. 56 more unit tests and new database tests. |
| `2779db2` *(on `phase/day-04-database`)* | 10-day plan, Day 1, Phase 1B: web foundation. Tailwind CSS 4.3.3 (with `@tailwindcss/vite`), React Router 8.4.0, TanStack Query 5.104.1, `radix-ui` 1.6.7, `clsx` 2.1.1 and `tailwind-merge` 3.7.0; API client with in-memory CSRF token and session-expiry handling; `AuthProvider`, `RequireAuth`, login page, protected app shell with permission-based navigation, sign-out, 403 and 404 pages; 34 more web tests. |
| `99dcda3` *(on `phase/day-04-database`)* | 10-day plan, Day 2 (migrations `0004`/`0005` applied to `hms_test` and `hms_dev`; demo data seeded into `hms_dev`): `patients` (sequence-generated MRN, duplicate warning with an identity lock, optimistic locking, trigram name search) and `doctor_profiles`; `GET/POST/PATCH /api/patients`, `GET /api/doctors`, `GET /api/departments` with permission checks and audit rows; shared Zod schemas used by API and web; `db:seed:demo` (synthetic departments, staff with one account per role, 6 doctors, 40 patients; hidden password prompt); patient search, registration, detail and edit pages and the doctor directory. |
| *(pending, `phase/day-04-database`)* | 10-day plan, Day 3, Phase 3A (migrations `0006`–`0008` applied to `hms_test` and `hms_dev`; no schedules or appointments seeded): `doctor_schedules`, `schedule_exceptions` and `appointments`; GiST exclusions against doctor and patient overlap and overlapping weekly sessions; appointment status-machine trigger; `hms_app` grants without DELETE; non-blank cancellation reason; shared appointment statuses and transitions; schema, privilege, constraint and trigger database tests and a 10-connection double-booking race test. |
