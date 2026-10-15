# HospitalOS: 30-day roadmap

Status: approved plan, Day 2 (2026-10-14). Rebalanced after the Day 2 review. Acceptance updated 2026-10-15 for scope clarifications C1–C4; see [Test milestones](#test-milestones).

The plan assumes about **7 hours per day, roughly 210 hours** in total.

- **Slip valve:** Tier 3 (days 21–22) is **deferred, not merely thinned,** whenever core-workflow completion, security or testing is at risk. The items marked *(optional)* go first.
- **Buffer:** Day 30 is kept free.
- **Protected time:** integration testing (Day 25), permission and failure testing (Day 26), security review (Day 27), production deployment (Day 28) and the backup drill (Day 29) are never cut.

Every phase ends with a stop for your review. Acceptance IDs refer to [`requirements.md`](requirements.md).

**Tier 3 is consolidated.** HR and equipment share one day, and marketing has one day. That frees two days, which are used to split the overloaded Tier 1 days found in the review. This uses the slip valve agreed in D2 in advance, rather than waiting for an overrun.

| Day | Milestone | Depends on | Acceptance |
|---|---|---|---|
| 1 | Repository and environment audit | — | Audit report |
| 2 | Design docs approved; you install Docker | 1 | `docker run postgres:17` connects |
| 3 | npm workspaces, TypeScript, ESLint and Prettier, `.gitignore`, `.env.example`, docker-compose (`postgres:17.11-bookworm` pinned by digest; `hms_dev`, `hms_test`), Zod environment validation, CI with the same pinned Postgres service | 2 | CI green; the app won't start if an environment variable is missing |
| 4 | Drizzle and the migration pipeline (generated and hand-written SQL), `hms_owner` and `hms_app` roles and grants, identity and settings tables, `audit_logs` with its append-only trigger, **first, reconcile `ROLE_CODES` and its test to the 11 approved roles (before any role seeding or enforcement)**; permission seed (including the C1–C3 permission codes), Express skeleton, error handler, redacted logging; **API route prefix `/api`**: mount every API route (including health) under `/api` and remove the temporary Vite proxy rewrite, so development and production use the same paths | 3 | Migrations apply to an empty database; `hms_app` can't DELETE; error-shape test; `GET /api/health` works directly and through the Vite proxy with no rewrite |
| 5 | helmet, rate limiting, sessions, login and lockout, CSRF, `requirePermission`, audit library (including system actor). **Hosting spike and dry-run deployment** of the API health check plus the database. | 4 | SE-2, SE-3, SE-4, SE-6, AD-5; the deployed health check reaches managed Postgres 17 with the required extensions |
| 6 | Web shell (login page, role layouts, API client); patients API, search, duplicate warning, audit | 5 | PR-1 to PR-4 |
| 7 | Patient UI; departments, doctors, schedules, exceptions | 6 | Schedule tests; SC-2 |
| 8 | **Slot engine and booking** (EXCLUDE constraint and advisory lock) | 7 | SC-1, BK-1 to BK-3 |
| 9 | Cancel, reschedule, check-in, walk-ins, queue; vitals at triage; reception UI; **day-close job, step 1 (no-show)** | 8 | BK-4, BK-5, QU-1 to QU-4, JB-1 (appointment part), JB-4 to JB-6 |
| 10 | Encounters, diagnoses, notes (editable while in progress); nurse-assignments API (moved from Day 7, built with the nurse rule that uses it); **access service** (care rules 1 and 2, assignment-based nurse rule); clinical read audit | 9 | AX-1, AX-2, AX-7 to AX-9, AX-11, AX-13, CN-1 to CN-3 |
| 11 | **Emergency access** (grant, no cap, priority review, revoke, review API); doctor UI (queue, chart, consultation form) | 10 | AX-4 to AX-6, AX-10 |
| 12 | Medicine catalogue (ingredients, products, equivalence trigger), batches, locations (`OPD-PHARM`, `GEN-STORE`), synthetic catalogue seed; availability search API and doctor UI | 11 | RX-1 to RX-3 |
| 13 | Prescriptions (allergy acknowledgement, substitution flag, cancel); follow-ups; care rule 3; **day-close steps 2 and 3** | 12 | RX-4, FU-1 to FU-4, AX-3, JB-1 to JB-3 |
| 14 | Billing core: service catalogue, `doctor_fees`, invoices, items with typed FKs, deferred totals triggers, document numbering, consultation fee at check-in | 9, 13 | CF-1 to CF-3, CF-5, BL-1, BL-10; CF-4 (check-in and consultation part) |
| 15 | Payments with idempotency, configurable discount threshold and approval, discarding drafts, void, credit notes (manual and workflow origin), refunds; billing UI | 14 | DS-1 to DS-6, BL-2 to BL-7, BL-9, BL-11, BL-12 |
| 16 | **Dispensing transaction** (permission, expiry, substitution, medicine-only and stock checks on the server); pharmacy queue UI | 13, 15 | DP-1 to DP-4, DP-6, DP-8, DP-10, EX-1 to EX-5, SB-1 to SB-5; CF-4 (dispensing part) |
| 17 | Returns (`dispensing_returns`, return window, restock checklist, cold-chain rule), pharmacy stock adjustments (`stock:adjust_pharmacy`), **concurrent stock-update tests**, low-stock and expiry queries | 16 | DP-5, DP-7, DP-9, DP-11, ST-1, ST-3 to ST-5, ST-8 (dispensing and adjustment part) |
| 18 | Procurement: suppliers, purchase orders, goods receipts into the general store; general-store adjustments (`stock:adjust_store`); valuation; stock transfers with source-based dispatch, explicit acceptance or rejection by a different user, and audited returns *(optional: deferred if short, never reduced to one step)* | 17 | A goods receipt creates a batch and a movement; the composite FKs reject a mismatched supplier, item or location kind; DP-6 still holds; ST-2, ST-6, ST-8 (receipt part); ST-7, ST-9 to ST-12 if transfers are built |
| 19 | Lab: catalogue, orders, sample collection (LAB only), results, verification, care rule 4, lab cancel credit; lab PDF *(optional)* | 10, 15 | LB-1 to LB-5, AX-12; CF-4 (lab part) |
| 20 | Invoice and receipt PDFs; expenses with approval; collection and department revenue reports | 15 | BL-8; the creator can't approve their own expense |
| 21 | Tier 3 (thin): HR (employees, attendance, leave, manual payroll) and equipment and maintenance (INV's equipment permission group) | 5 | Permission tests; AX-9 for HR and INV |
| 22 | **Users, role-assignment and settings API** (SA and ADM; Tier 1, moved from Day 7, never deferred); Tier 3 (thin): marketing (enquiries, campaigns, consent, conversion report) | 5, 6 | AD-1 to AD-4, AD-7, AD-8; AX-9 for MKT |
| 23 | Dashboards for REC, DOC and PHA | 9–19 | DB-1 |
| 24 | Dashboards for ADM (including the emergency-access review queue and stuck appointments) and FIN; audit-log viewer for SA and ADM | 20, 23 | DB-1, AD-6 |
| 25 | **Integration:** the 12-step end-to-end scenario as an automated API test; Playwright for the happy path *(optional)* | all | Scenario green |
| 26 | **Permissions and failure cases:** a table-driven test across all endpoints and roles; every required failure case | 25 | SE-1, SE-5; failure list in requirements section 6 |
| 27 | **Security review** (dependency audit, headers, cookies, CSRF, rate limits, log redaction, upload limits) and fixes | 26 | Review checklist closed |
| 28 | **Production deployment** (managed database migrations, secrets, HTTPS-only cookies) | 27 | Production smoke test |
| 29 | **Backup and restore drill**, demo seed data, README and runbook | 28 | A restored copy passes the smoke test |
| 30 | Buffer and demo rehearsal | — | Scenario demonstrated live |

## Test milestones

Each test is scheduled with the feature it protects, never before the schema and code it needs.

**Day 7 rebalance (2026-10-15).** Day 7 keeps the patient UI and scheduling setup. The nurse-assignments API moves to Day 10, where the nurse access rule consumes it (AX-13 was already tested there). The users, role-assignment and settings API moves to Day 22 and shares it with thin Tier 3 marketing. If Day 22 is short, marketing is deferred, never the admin API. Until Day 22, the seed assigns roles and default settings. Day 8 (booking concurrency, BK-2) is unchanged. No acceptance criteria were removed.

| Day | Feature | Tests | Depends on |
|---|---|---|---|
| 4 | `audit_logs` table, append-only trigger, `hms_app` grants, permission seed | (schema only; tested on Day 5) | 3 |
| 5 | Audit library, sessions, `requirePermission` | AD-5 (audit immutability and authorization) | 4 |
| 17 | Pharmacy stock adjustments | ST-1, ST-3 to ST-5, ST-8 (dispensing and adjustment part) | 12, 16 |
| 18 | Goods receipts, general store, transfers | ST-2, ST-6, ST-8 (receipt part); ST-7, ST-9 to ST-12 (transfer permissions, separate users, rejection and return, conservation) if transfers are built; if deferred, they move with the transfer feature unchanged | 17 |
| 22 | Users, role-assignment and settings API | AD-1 to AD-4 (user and role management), AD-7 (settings permissions), AD-8 (onboarding with no role) | 5, 6 |
| 24 | Audit-log viewer | AD-6 (viewer access and privacy, single non-recursive search event) | 5, 23 |
| 26 | Table-driven permission test across every endpoint and role | SE-1, covering every new permission code | 25 |

## Hours by phase

| Days | Phase | Hours |
|---|---|---|
| 1–5 | Foundation | ~35 |
| 6–13 | Patient and doctor workflows | ~56 |
| 14–19 | Money, medicines, supplies and lab | ~42 |
| 20–24 | Administration and dashboards | ~35 |
| 25–30 | Testing and delivery | ~42 |

Compared with the original five-phase outline, the "patient and doctor workflows" phase is now one day longer (8 days instead of 7), and "administration and dashboards" is one day shorter. Total hours are unchanged.

## Risk

- **Highest-risk days:** 5 (authentication and deployment), 8 (booking concurrency), 10 (access service), 15 (billing corrections), 16 (dispensing) and 17 (concurrent stock).
- **If a day slips, the time comes from these, in order:**
  1. the optional items (transfers, lab PDF, Playwright)
  2. Tier 3 depth (days 21 and 22)
  3. the Day 30 buffer
- That reserve totals roughly 25 hours. Integration testing, security and deployment (days 25–29) are never used as a reserve.
