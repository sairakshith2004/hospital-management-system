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
6. [Local database](#local-database)
7. [npm scripts](#npm-scripts)
8. [Code quality tooling](#code-quality-tooling)
9. [Security practices](#security-practices)
10. [Git workflow](#git-workflow)
11. [Design documents](#design-documents)
12. [Roadmap](#roadmap)
13. [Change log](#change-log)

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

**What doesn't exist yet:** application code (API, web app, shared package), database tables and migrations, and CI. See the [Roadmap](#roadmap).

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
├── docker/
│   └── postgres/init/
│       └── 01-databases.sql      Runs once on a fresh database volume: creates hms_test and extensions
├── docker-compose.yml            Local PostgreSQL 17.11 (digest-pinned, localhost only)
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

**Planned workspaces** (declared in `package.json`; folders arrive in later Day 3 commits):

```
apps/api/          Express API
apps/web/          React web app
packages/shared/   Code shared by API and web (Zod schemas, role and permission codes)
```

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
npm run lint && npm run format:check && npm test
```

On Linux, use `sed -i` (without `''`) in step 3.

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
| `npm test` | Runs all Vitest tests. Passes with no tests until the first tests arrive in the next commit. |
| `npm run build` | Builds every workspace that has a `build` script |
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
| Commit 4 | `packages/shared` and `apps/api`: environment validation, `GET /health`, first tests |
| Commit 5 | `apps/web`: minimal Vite + React + TypeScript app |
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
| *(README commit)* | README rewritten to document how the project works; kept up to date from now on. Pushed directly to `main` with the Day 3 commits above. |
