# hospital-management-system

**HospitalOS** is an outpatient Hospital Management System for a single multispecialty hospital, built by one developer as a 30-day challenge. It is a **modular monolith**: a React web app, an Express API and a PostgreSQL database in one repository.

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
| Day 3: project foundation | 🚧 In progress. The first Day 3 commits (safeguard docs, root tooling, local Postgres, this README) are on `main`. |

**What exists today:**
- Design documentation in `docs/`.
- Root tooling: npm workspaces, TypeScript, ESLint, Prettier and Vitest.
- A local PostgreSQL 17.11 database running in Docker.
- `packages/shared`: the 12 role codes, shared by API and web.
- `apps/api`: an Express API skeleton with configuration validation and a `GET /health` endpoint (no database access yet).
- `apps/web`: a minimal React + TypeScript web app (Vite) with a HospitalOS landing screen and a live API-status indicator.
- 20 automated tests.

**What doesn't exist yet:** database tables and migrations, authentication, patient features, styling with Tailwind CSS and shadcn/ui (Day 6), and CI. See the [Roadmap](#roadmap).

---

## Technology stack

| Layer | Choice |
|---|---|
| Frontend | React, TypeScript, Vite. Tailwind CSS and shadcn/ui are added on Day 6. |
| Backend | Node.js 24, TypeScript, Express, Zod validation |
| Database | PostgreSQL 17.11 with Drizzle ORM (migrations start on Day 4) |
| Testing | Vitest. Playwright for end-to-end tests if time allows. |
| Tooling | npm workspaces, ESLint, Prettier, Docker Compose, GitHub Actions (CI is added on Day 3) |

The reasons behind each choice are in the [architecture decision records](docs/adr/).

---

## Repository layout

What's in the repository right now:

```
.
├── docs/                         Design documentation (see "Design documents")
│   └── adr/                      Architecture decision records 0001–0013
├── apps/
│   ├── api/                      Express API (@hospitalos/api)
│   │   ├── package.json          Scripts: dev, start, typecheck
│   │   ├── tsconfig.json         Node ESM settings (NodeNext)
│   │   └── src/
│   │       ├── server.ts         Entry point: validate config → start listening → shut down cleanly
│   │       ├── app.ts            createApp(): builds the Express app and its routes
│   │       ├── app.test.ts       Tests for GET /health
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
│           └── *.test.ts(x)      Tests for api.ts, ApiStatus and App
├── packages/
│   └── shared/                   Code shared by API and web (@hospitalos/shared)
│       └── src/
│           ├── index.ts          ROLE_CODES: the 12 roles from docs/permissions.md
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
├── .prettierignore               Prettier never reformats docs/ or this README
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

# 3. Create your local .env from the template, with a random database password.
#    The password is never printed. .env is git-ignored and must never be committed.
cp .env.example .env
PW=$(openssl rand -hex 24)
sed -i '' -e "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$PW/" -e "s/CHANGE_ME/$PW/g" .env   # macOS sed
unset PW
chmod 600 .env

# 4. Start the database and wait until it's healthy
npm run db:up

# 5. Check that everything works
npm run lint && npm run format:check && npm run typecheck && npm test

# 6. Run the API and call its health endpoint
npm run dev:api                      # in one terminal; Ctrl+C stops it
curl -s 127.0.0.1:3000/health        # in another: {"status":"ok"}

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
                              └─ invalid → print problems,     └─ GET /health → 200 {"status":"ok"}
                                 exit with code 1
```

**Environment variables:**
| Variable | Required | Default | Rule |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | Must be a `postgres://` or `postgresql://` URL. Required even though the database isn't used until Day 4, so a misconfigured app never starts. |
| `PORT` | No | `3000` | Whole number from 1 to 65535 |
| `HOST` | No | `127.0.0.1` | Address to listen on. Localhost by default; a deployed container would set `0.0.0.0`. |
| `NODE_ENV` | No | `development` | `development`, `test` or `production` |

**If the configuration is wrong,** the API refuses to start and lists every problem. It names the variable and the rule, **never the value**, so a password can't leak into the terminal or logs. For example:
```
Invalid environment configuration:
- PORT: Too big: expected number to be <=65535
- DATABASE_URL: Invalid URL
```

**`GET /health`** reports only that the process is running: `200 {"status":"ok"}`. It deliberately exposes no version, environment or configuration details. The Express `X-Powered-By` header is turned off, and JSON request bodies are limited to 100 KB. A database readiness check arrives on Day 4.

**Why `app.ts` and `server.ts` are separate:** `createApp()` only builds the app; `server.ts` starts it. Tests use the app directly through `supertest` without opening a network port, and future middleware (security headers, sessions, CSRF) is added in one place.

**Logging:** plain `console` for now. On Day 4 it's replaced by a structured logger (pino) that strips sensitive fields.

---

## Running the web app

Use two terminals: `npm run dev:api` in the first and `npm run dev:web` in the second. Then open **http://127.0.0.1:5173**. The database isn't needed yet.

**What you'll see:** the HospitalOS heading, a synthetic-data notice, and a **System status** card that reads:
- **Checking API…** while the request is in flight
- **API online** when the API answered `{"status":"ok"}`
- **API unreachable** on an error, a timeout (5 seconds) or an unexpected answer

The **Check again** button repeats the check.

**How the browser reaches the API (the Vite proxy):**
```
Browser ──GET /api/health──► Vite dev server (127.0.0.1:5173) ──GET /health──► API (127.0.0.1:3000)
```
The browser only ever talks to one address, so the API needs **no CORS configuration**. The web app always calls paths starting with `/api/`.

> **Temporary compatibility arrangement:** the API's routes don't have an `/api` prefix yet, so the proxy currently strips `/api` before forwarding (`/api/health` → `/health`). On Day 4 the API will put every route under `/api` and the rewrite will be removed, so development and production use identical paths. See [`docs/roadmap.md`](docs/roadmap.md), Day 4.

**Accessibility:**
- The status is announced to screen readers (`role="status"`, `aria-live="polite"`) and always written in words, never shown by colour alone.
- Text and status colours meet WCAG AA contrast.
- Keyboard focus is clearly visible.
- Animations are turned off for users who ask for reduced motion.

**Styling:** deliberately minimal CSS in `src/index.css`. Tailwind CSS and shadcn/ui arrive on Day 6 (see [`docs/architecture.md`](docs/architecture.md) §8).

**Security:** the web app reads no environment variables, so it can't leak a secret into the browser bundle. Vite would only read `.env` files inside `apps/web`, and none exist there. Both dev servers listen on `127.0.0.1` only.

**Production build:** `npm run build` writes static files to `apps/web/dist/`, which git ignores. `npm run preview -w @hospitalos/web` serves them at `http://127.0.0.1:4173`. That preview server has no `/api` proxy, so the status card shows "API unreachable" there; this is expected until deployment routing is set up (Day 5).

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

**Database users:** the `POSTGRES_USER` account is the container's superuser and is for local development only. From Day 4, the application uses least-privilege roles (`hms_owner` for migrations, `hms_app` for the running app); see [ADR 0006](docs/adr/0006-postgresql-docker.md).

---

## npm scripts

Run these from the repository root.

| Script | What it does |
|---|---|
| `npm run lint` | ESLint over the whole repository |
| `npm run format` | Prettier: rewrites files to the project style |
| `npm run format:check` | Prettier: checks only, changes nothing (used in CI) |
| `npm run typecheck` | Type-checks every workspace that has a `typecheck` script |
| `npm test` | Runs all Vitest tests (currently 20, in 6 files). Web tests run in a simulated browser (jsdom). No database or running server is needed. |
| `npm run dev:api` | Starts the API in watch mode at `http://127.0.0.1:3000` |
| `npm run dev:web` | Starts the web app at `http://127.0.0.1:5173`, forwarding `/api/*` to the API |
| `npm run build` | Builds every workspace that has a `build` script; today that's the web app, into `apps/web/dist/` |
| `npm run db:up` | Starts PostgreSQL and waits until it's healthy |
| `npm run db:down` | Stops PostgreSQL (keeps data) |
| `npm run db:psql` | Opens `psql` on `hms_dev` inside the container |

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
| tsx | 4.23.15 | dev | Runs TypeScript directly, with watch mode |
| supertest | 7.3.1 | dev | Calls the Express app in tests without a network port |
| @types/express, @types/node, @types/supertest | 5.0.6, 26.6.5, 7.2.1 | dev | Type definitions |

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

**Blocked install script:** npm 11 doesn't run packages' install scripts unless they're approved.
- **Exactly one is blocked:** `esbuild`'s `postinstall` (`node install.js`). esbuild is used by `tsx` and by Vite inside Vitest.
- **Nothing is broken by this.** esbuild's binary for your platform (for example `@esbuild/darwin-arm64`) is installed as a separate optional package. The API starts and all tests pass without the script.
- **What the script would do:** download the binary if that package were missing, and slightly speed up the command-line tool's startup.
- **What to do if it ever fails** (for example if optional dependencies were skipped): approve only esbuild with `npm install-scripts approve esbuild`, never all scripts.
- `npm install-scripts ls` shows the current list.

---

## Security practices

- **Secrets live only in `.env`.** It's git-ignored, readable only by you (`chmod 600`), and never printed. `.env.example` holds names and placeholders only.
- **The database listens only on localhost.**
- **Docker images are pinned by digest**, and npm dependencies by exact version via the lockfile.
- **Authorization is always checked on the server** (from Day 5). The UI never decides who may see what. See [`docs/permissions.md`](docs/permissions.md).
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
| [`docs/requirements.md`](docs/requirements.md) | Scope, functional requirements per role, approved safeguards, 101 acceptance criteria |
| [`docs/architecture.md`](docs/architecture.md) | System shape, module rules, conventions, end-of-day job, frontend styling plan |
| [`docs/erd.md`](docs/erd.md) | Every table, key, constraint and index; transaction boundaries; the dispensing algorithm |
| [`docs/permissions.md`](docs/permissions.md) | The 12-role permission matrix, patient-data access rules, emergency access |
| [`docs/state-machines.md`](docs/state-machines.md) | Lifecycles for appointments, encounters, prescriptions, invoices and more |
| [`docs/roadmap.md`](docs/roadmap.md) | The 30-day plan with acceptance tests per day |
| [`docs/adr/`](docs/adr/) | 13 architecture decision records |

---

## Roadmap

The full day-by-day plan is in [`docs/roadmap.md`](docs/roadmap.md). The rest of Day 3:

| Next commit | Adds |
|---|---|
| Commit 6 | GitHub Actions CI (lint, format, typecheck, test, build) with the pinned Postgres service |

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
| *(commit 5)* | Minimal React + TypeScript web app: landing screen, API-status indicator, `/api` dev proxy (temporary rewrite), React Hooks lint rules, 9 more tests |
