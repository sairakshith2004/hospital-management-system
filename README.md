# HospitalOS — Hospital Management System

**HospitalOS** is an outpatient hospital management system for one multispecialty hospital. Reception, doctors, nurses, pharmacy, laboratory, billing, inventory, HR, finance and administration all work in **one web app on one shared database**. Each person signs in with their own account and sees only what their role allows.

It is a **modular monolith**: a React web app, an Express API and a PostgreSQL database in one repository (npm workspaces).

> ⚠️ **Synthetic data only.** HospitalOS has not been assessed against India's DPDP Act and Rules or clinical-records requirements. Do not put real patient data in it without legal, clinical and security review. The system never diagnoses patients or recommends treatment.

This README is kept up to date with every change. Detailed design lives in [`docs/`](docs/).

---

## Contents

1. [What HospitalOS does](#1-what-hospitalos-does)
2. [Running the project](#2-running-the-project)
3. [Sign-in accounts (user IDs and passwords)](#3-sign-in-accounts-user-ids-and-passwords)
4. [How it works](#4-how-it-works)
5. [Modules in detail](#5-modules-in-detail)
6. [API reference (main endpoints)](#6-api-reference-main-endpoints)
7. [Configuration (`.env`)](#7-configuration-env)
8. [Database](#8-database)
9. [npm scripts](#9-npm-scripts)
10. [Testing and CI](#10-testing-and-ci)
11. [Repository layout](#11-repository-layout)
12. [Security practices](#12-security-practices)
13. [Updates from Day 1](#13-updates-from-day-1)
14. [Known limits and what's next](#14-known-limits-and-whats-next)
15. [Design documents](#15-design-documents)

---

## 1. What HospitalOS does

| Area | What staff can do |
|---|---|
| **Front desk** | Search and register patients (automatic patient number, e.g. `MRN000123`), book appointments from live availability, walk-ins with tokens, check-in, cancel, reschedule, no-show, follow-ups |
| **Doctors** | Own appointments and queue, consultations (vitals, notes, diagnoses, allergies), prescriptions with allergy warnings, lab orders, follow-ups, patient chart, own earnings |
| **Pharmacy** | Prescription queue, **first-expiry-first-out** dispensing, stock and transfers, **look up a patient by number** to see prescriptions to dispense and past ones |
| **Laboratory** | Worklist, sample collection, results with abnormal flags, verification by a second person, 189-test catalogue, **look up a patient by number** to see tests to do and previous results |
| **Billing** | One invoice per visit (consultation, lab and medicine charges added automatically), payments, receipts, **look up a patient by number** to see bills to pay and past bills |
| **Inventory** | Goods receipts, store ↔ pharmacy transfers, adjustments, low stock, equipment register and maintenance |
| **HR** | **Adds new staff and creates their logins**, attendance, leave approval (only HR decides leave) |
| **Finance** | Expenses, finance summary, doctor earnings |
| **Administration** | Departments, doctor profiles and schedules, settings, audit log, account disable/enable and password reset |
| **Super Admin (head of the hospital)** | Access to everything: every department's dashboard, menu and actions (including dispensing, lab work, vitals and, with a doctor profile, consultations), assigns roles |
| **Communication** | Notices, staff chat, doctor call requests, **video meetings** (instant, emergency and **scheduled conferences**, up to 50 people with LiveKit) |
| **Accounts** | Everyone changes their own password; **forgot password** by an emailed one-time link; new staff choose their own password at first sign-in |

---

## 2. Running the project

### 2.1 Every day (already set up)

You need **Docker Desktop running**. Then, from the repository folder:

```bash
npm run db:up        # 1. start PostgreSQL (waits until healthy)
npm run video:up     # 2. optional: LiveKit video server (large video calls)
npm run mail:up      # 3. optional: Mailpit, the local inbox for "forgot password" emails

npm run dev:api      # 4. terminal 1: the API on http://127.0.0.1:3000
npm run dev:web      # 5. terminal 2: the web app on http://127.0.0.1:5173
```

Open **http://127.0.0.1:5173** and sign in (see [section 3](#3-sign-in-accounts-user-ids-and-passwords)).

| Service | Address | Started by |
|---|---|---|
| Web app | http://127.0.0.1:5173 | `npm run dev:web` |
| API | http://127.0.0.1:3000 (`/api/health` → `{"status":"ok"}`) | `npm run dev:api` |
| PostgreSQL | 127.0.0.1:5432 (`hms_dev`, `hms_test`) | `npm run db:up` |
| LiveKit (video) | ws://127.0.0.1:7880 | `npm run video:up` |
| Mailpit inbox | http://127.0.0.1:8025 (SMTP on 1025) | `npm run mail:up` |

Always use `127.0.0.1`, not `localhost`: the browser keeps a separate session cookie for each.

To stop: `Ctrl+C` in the two terminals, then `npm run db:down`, `npm run video:down`, `npm run mail:down` (data is kept).

### 2.2 First-time setup (new machine)

**Prerequisites:** Node.js 24 (`node -v`), npm 11, Docker Desktop with Compose v2, Git.

```bash
# 1. Get the code and install exact dependency versions
git clone https://github.com/sairakshith2004/hospital-management-system.git
cd hospital-management-system
npm ci

# 2. Create .env with random secrets (never printed; .env is git-ignored)
cp .env.example .env
SU=$(openssl rand -hex 24); OWNER=$(openssl rand -hex 24); APP=$(openssl rand -hex 24)
SESSION=$(openssl rand -hex 32)
sed -i '' -e "s/^SESSION_SECRET=.*/SESSION_SECRET=$SESSION/" \
  -e "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$SU/" \
  -e "s/CHANGE_ME_OWNER/$OWNER/g" -e "s/CHANGE_ME_APP/$APP/g" -e "s/CHANGE_ME/$SU/g" .env
unset SU OWNER APP SESSION
chmod 600 .env
# (On Linux use `sed -i` without the empty '' argument.)

# 3. Database: start, check settings, create roles, apply migrations, load reference data
npm run db:up
npm run db:env:check
npm run db:roles
npm run db:migrate && npm run db:migrate:test
npm run db:seed && npm run db:seed:test

# 4. First Super Admin (you type the password at a hidden prompt)
npm run db:bootstrap-admin -- --username admin

# 5. Optional demo data (synthetic): staff, doctors, patients, medicines, lab tests, schedules
npm run db:seed:demo              # asks once for the shared demo-account password
npm run db:seed:demo:catalogue
npm run db:seed:demo:specialists
npm run db:seed:demo:schedules
npm run db:seed:demo:formulary
npm run db:seed:demo:lab-tests

# 6. Optional: video and email (see section 7 for the .env lines)
#    LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET  → then npm run video:up
#    SMTP_URL=smtp://127.0.0.1:1025 and APP_URL         → then npm run mail:up

# 7. Check everything, then run (section 2.1)
npm run lint && npm run format:check && npm run typecheck && npm test && npm run test:db
```

---

## 3. Sign-in accounts (user IDs and passwords)

### 3.1 About passwords

**Passwords are not written in this README, on purpose.** HospitalOS stores only an argon2id hash of each password, never the password itself, so nobody (including the code and this README) can read one back. A README pushed to GitHub would also let anyone who sees the repository sign in.

| Accounts | Password |
|---|---|
| `admin` (Super Admin) | The one typed at `npm run db:bootstrap-admin` |
| All demo accounts below (staff and the 26 doctors) | One shared demo password, typed once at the hidden prompt of `npm run db:seed:demo` (the specialist doctors reuse the same one) |
| Staff added later by HR | The first password HR sets; the person must choose their own at first sign-in |

**Forgot a password?**
- **In the app:** *Forgot password?* on the sign-in page emails a one-time reset link (works when HR has added a work email for that person). In local development the email appears in Mailpit at http://127.0.0.1:8025.
- **Administrator:** the Staff page → **Reset password** (the person must then choose their own at next sign-in).
- **Nobody can sign in (for example the `admin` password is lost):** in a terminal, `npm run db:reset-password -- --username admin` sets a new password at a hidden prompt (development database only).

### 3.2 Accounts on the development database (`hms_dev`)

All names and data are synthetic.

**Management and departments**

| Username | Name | Role | Department / job |
|---|---|---|---|
| `admin` | System Administrator | **SA** Super Admin (hospital CEO) | Administration |
| `adm1` | Sunita Reddy | **ADM** Hospital Administrator | Administration |
| `hr1` | Anil Joshi | **HR** | Administration, HR Officer |
| `rec1` | Priya Sharma | **REC** Reception | Front Office, Receptionist |
| `nur1` | Lakshmi Pillai | **NUR** Nurse | General Medicine, Staff Nurse |
| `pha1` | Suresh Kumar | **PHA** Pharmacist | Pharmacy |
| `lab1` | Neha Gupta | **LAB** Laboratory | Laboratory, Lab Technician |
| `fin1` | Rahul Verma | **FIN** Finance / Billing | Accounts, Billing Officer |
| `inv1` | Deepak Singh | **INV** Inventory | Pharmacy, Store Keeper |
| `mkt1` | Pooja Bansal | **MKT** Outreach / Marketing | Front Office |
| `sairakshith2510` | Sairakshith | **DOC** (role given by the Super Admin) | helper; added by HR, chose their own password at first sign-in |

**Doctors (role DOC, all Consultants)**

| Username | Doctor | Department | | Username | Doctor | Department |
|---|---|---|---|---|---|---|
| `ananya` | Dr. Ananya Rao | General Medicine | | `nisha` | Dr. Nisha Varma | Cardiology |
| `rohan` | Dr. Rohan Das | General Medicine | | `sanjay` | Dr. Sanjay Kulkarni | Cardiology |
| `deepak` | Dr. Deepak Chauhan | General Medicine | | `rahul` | Dr. Rahul Bhatt | Neurology |
| `vikram` | Dr. Vikram Shah | Paediatrics | | `divya` | Dr. Divya Krishnan | Gastroenterology |
| `ritu` | Dr. Ritu Agarwal | Paediatrics | | `farhan` | Dr. Farhan Qureshi | Pulmonology |
| `meera` | Dr. Meera Iyer | Orthopaedics | | `lakshman` | Dr. Lakshman Reddy | Nephrology |
| `vinod` | Dr. Vinod Rao | Orthopaedics | | `shalini` | Dr. Shalini Gupta | Endocrinology |
| `arjun` | Dr. Arjun Menon | Dermatology | | `pooja` | Dr. Pooja Hegde | Obstetrics and Gynaecology |
| `kavya` | Dr. Kavya Nair | ENT | | `radhika` | Dr. Radhika Sen | Obstetrics and Gynaecology |
| `amit` | Dr. Amit Joshi | Ophthalmology | | `neha` | Dr. Neha Kapoor | Psychiatry |
| `harish` | Dr. Harish Patil | Urology | | `sunita` | Dr. Sunita Mishra | Oncology |
| `manoj` | Dr. Manoj Pillai | General Surgery | | `tanvi` | Dr. Tanvi Shetty | Dental |
| `karan` | Dr. Karan Malhotra | Physiotherapy | | `zoya` | Dr. Zoya Khan | Emergency Medicine |


### 3.3 What happens when you sign in

1. Sign in at `/login` with your username and password.
2. If HR or an administrator set your password, you're taken to **Choose your own password** first; nothing else works until you do (the API enforces this).
3. The **portal cards** page opens. Cards for your own roles open the app; others are greyed out (the Super Admin can open all). HR and the Super Admin also see **Add new staff member**.
4. Inside the app, the sidebar and dashboard show only what your permissions allow. **Password** in the top bar changes your password; **Sign out** ends the session.
5. Sessions end after 30 minutes idle or 12 hours in total.

**There is no public sign-up.** A new staff member gets their account from HR (Staff page → **Add staff member**, which creates the login). The account has no access until the Super Admin assigns a role.

---

## 4. How it works

### 4.1 The big picture

```
                    ┌──────────────────────────── one web app (React) ───────────────────────────┐
 Browser ──────────►│ sign-in → portal cards → role dashboard → modules (sidebar by permission)   │
 http://127.0.0.1:5173└───────────┬────────────────────────────────────────────────────────────────┘
                                 │ /api/* (same origin, Vite proxy; session cookie + CSRF header)
                                 ▼
                    ┌──────────── Express API (Node.js) ─────────────┐
                    │ helmet → request id → log → JSON body → session │──► PostgreSQL 17 (hms_dev)
                    │ → load user → CSRF → password-chosen check      │     66 tables, triggers, grants
                    │ → module routes (permission check per route)    │
                    │ → service (transaction + audit) → SQL           │──► LiveKit (video, optional)
                    │ Server-Sent Events for live chat/meeting updates│──► SMTP / Mailpit (reset emails)
                    └─────────────────────────────────────────────────┘
```

- **One app, shared records.** A patient registered at reception is the same record the doctor, pharmacy, lab and billing see. A prescription flows to the pharmacy queue, dispensing adds charges to the visit's invoice, and lab orders appear on the lab worklist.
- **The server decides everything.** The web app hides buttons a role can't use, but the API checks the session and the exact permission on **every** request, and checks record-level rules (for example, a doctor sees only their own patients' charts).
- **The database protects itself too.** Constraints, triggers and limited privileges stop double bookings, negative stock, edits to completed records and deletions, even if the API had a bug.

### 4.2 The patient journey

```
Reception                Doctor                         Pharmacy / Lab / Billing
─────────                ──────                         ────────────────────────
register patient (MRN) ─► sees booking in My appointments
book / walk-in           queue → start consultation
check-in (token) ───────► vitals, notes, diagnoses,
  └ draft invoice          allergies (warning on conflict)
    + consultation fee     prescription ───────────────► pharmacy queue → FEFO dispense
                           lab order ──────────────────► lab worklist → collect → result → verify
                           follow-up                                     (result back in chart)
                           complete (then addenda only)  billing: invoice gets lab + medicine lines
                                                         → issue → payment(s) → receipt
```

Any department can type the patient number (`MRN000123`, `mrn 123` or just `123`) to pull up that patient's records for their own work.

### 4.3 Roles and permissions

There are **11 roles** and **88 permissions** (`packages/shared/src/permissions.ts`, mirrored exactly in [`docs/permissions.md`](docs/permissions.md); a test fails if they differ). A user's permissions are the union of their roles. Roles are re-read on every request, so a change applies immediately.

| Code | Role | Main responsibilities |
|---|---|---|
| SA | Super Admin (head of the hospital) | **Everything: all 88 permissions**, clinical work included; assigns roles; reads any chart (audited as executive access). Records still name SA as the person who acted; consulting and prescribing need a doctor profile for the SA account; lab results SA enters are verified by someone else |
| ADM | Hospital Administrator | Departments, doctors, schedules, settings, audit log; disables/enables accounts and resets passwords |
| HR | Human Resources | **Adds staff and creates logins** (`user:create`), attendance, leave decisions |
| REC | Reception | Patients, appointments, check-in, queue, invoices and payments |
| DOC | Doctor | Own patients' consultations, prescriptions, lab orders, charts |
| NUR | Nurse | Vitals for checked-in patients, medicine search, call requests |
| PHA | Pharmacist | Dispensing, pharmacy stock and transfers, invoices |
| LAB | Laboratory | Sample collection, results, verification |
| FIN | Finance | Invoices, voids, prices, expenses, finance reports, doctor earnings |
| INV | Inventory | Store stock, goods receipts, transfers, equipment |
| MKT | Outreach | Enquiries and campaigns (never clinical data) |

Key rules: nobody changes their own roles or status; the last Super Admin can't be removed; only HR decides leave; a doctor sees only their own patients unless they ask for other doctors' reports (audited); pharmacy and lab see only what their work needs.

### 4.4 Accounts and passwords

| Step | Who | What happens |
|---|---|---|
| New staff member | **HR** (or SA) | Staff page → **Add staff member**: name, employee no., department, designation, optional work email, **username and first password** (required unless "won't use HospitalOS" is ticked) |
| Access | **Super Admin** | Assigns the role(s); until then the account can sign in but sees nothing |
| First sign-in | The person | Must choose their own password before anything else |
| Change password | Anyone signed in | **Password** in the top bar (current password required; other devices are signed out) |
| Forgot password | Anyone | *Forgot password?* → username or work email → one-time link by email (30 minutes, single use, max 3 per hour; the page never reveals whether the account exists) |
| Locked out / no email | **Administrator** | Staff page → **Reset password** (temporary; person chooses their own next time) |
| Leaver | HR / Administrator | Mark as left or **Disable**: signed out at once |

### 4.5 Live updates, chat and video

- The browser keeps one **Server-Sent Events** stream open (`/api/comm/events`). Events carry only a type and record IDs; the page then reloads data through the normal permission-checked API.
- **Video** uses WebRTC. With LiveKit configured, every browser sends its video once to the LiveKit server, so up to **50 people** can be in a call; without it, browsers connect directly to each other (up to 8). The API decides who may join and hands out a 5-minute LiveKit pass only after its own checks.
- **Emergency meetings** ring every invitee full-screen (even if they are in another call), and with **Turn on alerts** a desktop notification appears when the tab is in the background.

### 4.6 Data rules worth knowing

- **Money** is stored as whole paise (₹1 = 100 paise); **dates and "today"** use the hospital time zone, Asia/Kolkata.
- **Nothing clinical or financial is ever deleted.** Corrections are new rows; notes, payments, dispensings, stock movements and messages are append-only.
- **Every sensitive action is audited** (sign-ins, chart reads, patient lookups, prescriptions, dispensing, payments, account and role changes) in `audit_logs`, which nobody can edit or delete.

---

## 5. Modules in detail

| Module | What works | Who | Limits |
|---|---|---|---|
| **Front desk** | Patient search (MRN, phone or name, fuzzy) and registration with duplicate warning; booking from live availability; walk-ins with gap-free tokens; check-in, cancel, reschedule (one transaction), no-show; day list, queue, follow-ups to book | REC (ADM reads) | — |
| **Consultation** | **My appointments** and a 7-day list; queue → consultation; vitals (°F or °C), notes, diagnoses, allergies, prescriptions (allergy warning must be acknowledged), lab orders, follow-ups, complete (addenda only afterwards); chart shows the doctor's own records by default, **Previous reports from other doctors** on request (audited); allergies always shown | DOC (own patients; care relationship) | No nurse chart access |
| **Medicines** | Catalogue by ingredient, brand, strength and form (356 demo medicines); read-only stock for doctors | DOC/NUR search; PHA/INV manage | — |
| **Pharmacy** | Prescription queue with allergies; **first-expiry-first-out** dispensing (never expired, recalled or short-dated); near-expiry and allergy acknowledgements; idempotent; stock, prescription and invoice change together; **patient lookup by number** | PHA (SA read-only) | No substitutions or returns |
| **Inventory** | Goods receipts (batch, expiry, cost, price); store ↔ pharmacy transfers received by another user; adjustments with reasons; movement history; low stock | INV (store), PHA (pharmacy) | No purchase orders |
| **Laboratory** | 189 tests (136 lab tests, 9 checkup packages, department diagnostics) with reference ranges and prices; order → collect → results (abnormal flags) → verification by a different person; results in the doctor's chart; **patient lookup by number** (tests to do, previous results) | LAB; DOC orders | No imaging; one reference range per parameter |
| **Billing** | One draft invoice per visit, charges added automatically; manual services; gapless invoice numbers (`INV-2026-000001`); cash/card/UPI/bank, part payments; void unpaid; print view; **patient lookup by number** (to pay, drafts, past bills) | REC/PHA/FIN; FIN voids | No discounts, refunds or credit notes |
| **Administration** | Staff list; disable/enable, password reset, work email; roles (SA only); departments, locations, doctor profiles, weekly sessions, leave/blocked time, fees; settings; audit-log viewer | SA, ADM (HR adds staff) | No role editor |
| **HR** | **Add staff member** and **Create login** (shortcut card after sign-in); attendance; leave requests by everyone, decided only by HR (approved doctor leave blocks their schedule); leave counts per year | HR decides; everyone requests | No payroll or shifts |
| **Doctor reports** | Patients per doctor (counts) for reception; doctor earnings for finance/admin; **My earnings** for each doctor | REC, FIN, ADM, DOC (own) | Fees billed, not salaries |
| **Finance** | Expense categories, expenses approved by someone else, totals | FIN, ADM | Not statutory accounting |
| **Equipment** | Asset register, status, maintenance log | INV | — |
| **Outreach** | Enquiries, follow-ups, conversion to patient, referral sources, campaigns | REC/MKT, MKT | No clinical data |
| **Communication hub** | Chat button on every screen: **Notices** (SA/ADM/HR to everyone, a role, a department or a person), **Messages** (1-to-1 and groups up to 30), **Calls** (ask a doctor for a call; doctors set Available/Busy/Off duty) | Everyone (`message:send`) | No attachments |
| **Video meetings** | **New meeting**, **🚨 Emergency meeting** (full-screen ringing), **📹 Video call** from any chat, **Schedule for later** (up to 90 days; opens 10 min early; host can cancel; missed after 2 h), invite groups (**Staff heads** = Admin + HR + Super Admin, **All doctors**, nurses…) or individuals; mute, camera, screen share, meeting chat; desktop alerts | SA/ADM/DOC/NUR/HR create; invitees join | 50 live with LiveKit (8 without); calls across different networks need a TURN relay (not set up); no recording |
| **Accounts** | Change own password, forgot-password email link, forced first-sign-in change | Everyone | Needs a work email on file for the email link |

---

## 6. API reference (main endpoints)

All routes are under `/api`. Errors always look like `{"error":{"code":"…","message":"…","requestId":"…"}}`. Writes from a signed-in session need the `X-CSRF-Token` header.

**Accounts**

| Endpoint | Who | Result |
|---|---|---|
| `POST /api/auth/login` | public | `200 { user, csrfToken }` + session cookie; any failure `401 INVALID_CREDENTIALS` |
| `GET /api/auth/me` | signed in | `200 { user, csrfToken }` (`user.mustChangePassword` tells the app to force a change) |
| `POST /api/auth/logout` | signed in | `204` |
| `POST /api/auth/password/change` | signed in | `{ currentPassword, newPassword }` → `200` or `400 WRONG_PASSWORD` |
| `POST /api/auth/password/forgot` | public | `{ identifier }` → always `202` (never reveals whether an account exists) |
| `POST /api/auth/password/reset` | public | `{ token, password }` → `200` or `400 INVALID_RESET_LINK` |
| `POST /api/admin/staff` | HR, SA (`user:create`) | Add staff + login (`must change password` on first sign-in) |
| `POST /api/admin/staff/:employeeId/login` | HR, SA | Create a login for existing staff |
| `POST /api/admin/staff/:employeeId/email` | HR, ADM, SA | Set or clear the work email |
| `POST /api/admin/users/:id/status` · `/password` | ADM, SA (`user:manage`) | Disable/enable; reset password |
| `POST /api/admin/users/:id/roles/grant` · `/revoke` | SA (`user_role:assign`) | Roles |

Until someone with an HR- or admin-set password chooses their own, every other request returns `403 PASSWORD_CHANGE_REQUIRED`.

**Patients, scheduling and clinical:** `GET/POST/PATCH /api/patients`, `GET /api/doctors`, `GET /api/departments`, `GET /api/doctors/:id/availability`, `POST /api/appointments` (+ `/cancel`, `/reschedule`, `/check-in`, `/no-show`), `GET /api/queue`, `GET /api/patients/:id/chart`, `POST /api/appointments/:id/encounter`, `POST /api/encounters/:id/notes|diagnoses|prescriptions|lab-orders|follow-ups|complete`.

**Department work:** `GET /api/pharmacy/prescriptions`, `POST /api/pharmacy/prescriptions/:id/dispense`; `GET /api/lab/orders`, `POST /api/lab/orders/:id/collect|results|verify`; `GET /api/invoices`, `POST /api/invoices/:id/issue|payments|void`.

**Patient lookup by number (audited `patient.lookup`):** `GET /api/pharmacy/patients/:mrn`, `GET /api/lab/patients/:mrn`, `GET /api/billing/patients/:mrn`. Each returns identifiers only (MRN, name, date of birth, sex) plus that department's records.

**Communication:** `GET /api/comm/events` (live stream), `/api/comm/notices`, `/api/comm/conversations`, `/api/comm/calls`, `/api/comm/meetings` (`POST` with optional `scheduledFor`), `/api/comm/meetings/:id/join|leave|end|heartbeat|signal`.

The route files (`apps/api/src/modules/*/*.routes.ts`) start with a comment listing every endpoint and its permission.

---

## 7. Configuration (`.env`)

`.env` lives in the repository root, is git-ignored and must never be committed. `.env.example` lists every name with placeholders only. The API checks all settings at start-up and refuses to start with a clear message that **names the setting, never its value**.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | yes | — | API connection: role `hms_app` on `hms_dev` (refused if it's a superuser) |
| `SESSION_SECRET` | yes | — | Signs the session cookie (32+ characters) |
| `POSTGRES_USER`, `POSTGRES_PASSWORD` | yes | — | Docker superuser (used only by `db:roles`) |
| `ADMIN_DATABASE_URL` | for `db:roles` | — | Superuser on local `hms_dev` |
| `MIGRATION_DATABASE_URL`, `TEST_MIGRATION_DATABASE_URL` | for migrations | — | `hms_owner` on `hms_dev` / `hms_test` |
| `TEST_DATABASE_URL` | for `test:db` | — | `hms_app` on local `hms_test` |
| `HOST`, `PORT` | no | `127.0.0.1`, `3000` | Where the API listens |
| `NODE_ENV` | no | `development` | In development, sign-in rate limits and lockout are off so you can test freely |
| `LOG_LEVEL` | no | `info` | `fatal`…`silent` |
| `TRUST_PROXY` | no | `false` | Proxy hops for client IPs (`false`, 1–3) |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | no (all three or none) | — | Video server; e.g. `ws://127.0.0.1:7880`, `hospitalos`, `openssl rand -hex 32` |
| `LIVEKIT_BIND`, `LIVEKIT_NODE_IP` | no | `127.0.0.1` | Set to your LAN address to call from other computers |
| `SMTP_URL` | no | — | Email for reset links; local: `smtp://127.0.0.1:1025` (Mailpit) |
| `MAIL_FROM` | no | `HospitalOS <no-reply@hospitalos.local>` | Sender of emails |
| `APP_URL` | no | `http://127.0.0.1:5173` | Base of links in emails |

After changing `.env`, restart the API (`Ctrl+C`, then `npm run dev:api`).

---

## 8. Database

**PostgreSQL 17.11** in Docker (`postgres:17.11-bookworm`, pinned by digest), listening on `127.0.0.1:5432` only. Two databases: `hms_dev` (development) and `hms_test` (automated tests). Data lives in the Docker volume `hospitalos_hms_pgdata`.

### 8.1 Three roles, least privilege

| Role | Used by | Can do |
|---|---|---|
| `hms` | `db:roles` only | Container superuser; never used by the API |
| `hms_owner` | Migrations and seeds | Owns the schema |
| `hms_app` | The API and tests | Reads and writes data only, with exact per-table grants; **no DELETE** on clinical, financial or audit tables; `audit_logs` is insert-only |

Every script checks it is connected to the expected role and database (asking the server itself) before writing, and never prints passwords or connection strings.

### 8.2 Migrations (forward-only)

`apps/api/src/db/migrations/`, 26 files, applied in order. A migration is never edited after it's applied (checksums in `checksums.json` are tested), and a test forbids destructive SQL (`DROP`, `DELETE FROM`, `TRUNCATE`, `DISABLE TRIGGER`…). The one allowed exception is replacing a `CHECK` rule under the same name to widen it.

| Migrations | Adds |
|---|---|
| `0000`–`0001` | Departments, employees, users, roles, permissions, settings, append-only `audit_logs`; triggers and grants |
| `0002`–`0003` | Server-side sessions |
| `0004`–`0005` | Patients (sequence MRN, trigram search) and doctor profiles |
| `0006`–`0008` | Schedules, exceptions, appointments; no-double-booking exclusion constraints; appointment state machine |
| `0009`–`0010` | Inventory: locations, medicines, batches, movements, transfers, receipts |
| `0011`–`0012` | Clinical: encounters, vitals, notes, diagnoses, allergies, prescriptions, dispensing, follow-ups |
| `0013`–`0014` | Lab orders and results; invoices, lines, payments |
| `0015`–`0016` | HR, finance, equipment, outreach |
| `0017` | `users.pending_approval` (from the old sign-up; kept because migrations are forward-only) |
| `0018`–`0019` | Communication: notices, conversations, messages, call requests |
| `0020`–`0021` | Video meetings and participants |
| `0022`–`0023` | Scheduled meetings (`scheduled_for`, status `scheduled`) |
| `0024`–`0025` | Work email on staff, `must_change_password`, one-time password-reset links |

To add one: change `apps/api/src/db/schema/`, run `npm run db:generate -- --name=<name>` (or `--custom` for hand-written SQL), add its SHA-256 to `checksums.json`, then `npm run db:migrate:test` and `npm run db:migrate`.

### 8.3 Current contents of `hms_dev`

26 migrations · 66 tables · 88 permissions · 240 role grants (the Super Admin holds all 88) · 25 departments · 37 user accounts · 26 doctors · 44 patients · 356 medicines · 189 lab tests and diagnostics. All synthetic.

### 8.4 Backups

Before every change to `hms_dev` a backup is taken with `pg_dump` into `~/hospitalos-backups/` (outside the repository), and checked before continuing. Latest: `hms_dev-20261027-144517-before-sa-full-access.dump`.

---

## 9. npm scripts

Run from the repository root.

| Script | What it does |
|---|---|
| `npm run dev:api` | API in watch mode (http://127.0.0.1:3000) |
| `npm run dev:web` | Web app (http://127.0.0.1:5173), forwards `/api` to the API |
| `npm run build` | Production build of the web app into `apps/web/dist/` |
| `npm run lint` · `format` · `format:check` · `typecheck` | Code quality |
| `npm test` | Unit and web tests (no database needed) |
| `npm run test:db` | Database tests against `hms_test` (each test rolled back) |
| `npm run db:up` · `db:down` · `db:psql` | Start / stop PostgreSQL; open psql on `hms_dev` |
| `npm run video:up` · `video:down` | Start / stop the LiveKit video server |
| `npm run mail:up` · `mail:down` | Start / stop Mailpit (local email inbox) |
| `npm run db:env:check` | Reports each database setting as set / missing / invalid (never the value) |
| `npm run db:roles` | Creates `hms_owner` and `hms_app` (local only, safe to re-run) |
| `npm run db:migrate` · `db:migrate:test` | Apply pending migrations to `hms_dev` / `hms_test` |
| `npm run db:generate` | Generate the next migration from the schema (offline) |
| `npm run db:seed` · `db:seed:test` | Reference data: settings, permissions, roles (safe to re-run) |
| `npm run db:bootstrap-admin -- --username <name>` | First Super Admin (hidden password prompt; only if none exists) |
| `npm run db:reset-password -- --username <name>` | New password for one `hms_dev` account (hidden prompt) |
| `npm run db:seed:demo` | Demo departments, one account per role, 6 doctors, 40 patients (hidden prompt for the demo password) |
| `npm run db:seed:demo:specialists` | 15 more departments and 20 specialist doctors with weekly hours |
| `npm run db:seed:demo:schedules` | Demo doctors' Mon–Sat 09:00–13:00 sessions |
| `npm run db:seed:demo:catalogue` | Locations, starter medicines, supplier, lab tests, prices, opening stock |
| `npm run db:seed:demo:formulary` | 347-medicine formulary with opening stock |
| `npm run db:seed:demo:lab-tests` | 136 lab tests, 9 checkup packages, 50 department diagnostics |

All demo seeds work on `hms_dev` only, refuse in production, never change or delete existing rows, and are safe to re-run.

---

## 10. Testing and CI

| Suite | Command | Count | Covers |
|---|---|---|---|
| Unit and web | `npm test` | **355 tests in 51 files** | Validation, permissions map, migration guards, config, every page's key flows against a fake API |
| Database | `npm run test:db` | **285 tests in 24 files** | Privileges, triggers, seeds, every module's API and refusals, end-to-end hospital workflows, booking and check-in races, password flows |

Database tests run on `hms_test` only (the helpers refuse any other database) inside transactions that are rolled back; the race tests commit and clean up after themselves.

**CI** (`.github/workflows/ci.yml`) runs on pushes to `phase/day-04-database` and pull requests to `main`: lint, format, types, unit tests, build and `npm audit --audit-level=high`, plus a database job on a fresh PostgreSQL that applies all migrations, seeds twice and runs the database tests. Actions are pinned by commit SHA; no repository secrets are used.

---

## 11. Repository layout

```
.
├── apps/
│   ├── api/                         Express API (@hospitalos/api)
│   │   └── src/
│   │       ├── server.ts            Start-up: validate config → logger → mailer/LiveKit → listen
│   │       ├── app.ts               Middleware order and all /api routes
│   │       ├── config/env.ts        Settings schema (Zod)
│   │       ├── lib/                 errors, logger (redaction), audit, password (argon2id), mailer
│   │       ├── middleware/          request id, logging, session, auth (permissions, forced password change), CSRF, rate limits
│   │       ├── db/
│   │       │   ├── schema/          Drizzle table definitions
│   │       │   ├── migrations/      0000–0025, checksums.json, meta/
│   │       │   ├── seed/            reference data, demo seeds, bootstrap admin, reset password
│   │       │   └── test-db.ts       hms_test-only, rolled-back test helpers
│   │       └── modules/             auth, admin, patients, directory, scheduling, clinical,
│   │                                pharmacy, lab, billing, inventory, operations (HR/finance/
│   │                                equipment/outreach), reports, communication (chat, meetings, LiveKit)
│   └── web/                         React web app (@hospitalos/web)
│       └── src/
│           ├── App.tsx              Route table
│           ├── app/                 Shell, dashboards, navigation (by permission)
│           ├── features/            auth (sign-in, portals, passwords), patients, scheduling, clinical,
│           │                        pharmacy, lab, billing, inventory, admin, operations, reports, communication
│           ├── components/ui/       Buttons, inputs, tables, dialogs…
│           └── lib/                 API client (CSRF in memory), data hooks
├── packages/shared/                 Code shared by API and web: roles, permissions, Zod schemas, types
├── docker/                          postgres/init (creates hms_test), livekit/livekit.yaml
├── docker-compose.yml               PostgreSQL; LiveKit (`video` profile); Mailpit (`mail` profile); localhost only, digest-pinned
├── docs/                            Requirements, architecture, ERD, permissions, state machines, roadmap, ADRs
├── .github/workflows/ci.yml         CI
└── .env.example                     Setting names with placeholders (copy to .env)
```

**Technology:** React 19, TypeScript 6, Vite 8, Tailwind CSS 4, React Router 8, TanStack Query 5 · Node.js 24, Express 5, Zod 4, pino · PostgreSQL 17.11, Drizzle ORM, node-postgres · argon2id, express-session + connect-pg-simple, helmet, express-rate-limit · LiveKit (server 1.13.9, SDKs 2.19.1 / 2.22.4) · nodemailer 10.1.0, Mailpit 1.31.4 · Vitest, Testing Library, supertest · ESLint, Prettier, GitHub Actions. All npm versions are pinned exactly (`save-exact`), Docker images by digest. Reasons are in [`docs/adr/`](docs/adr/).

---

## 12. Security practices

- **Secrets only in `.env`**, git-ignored and `chmod 600`; never printed, logged or committed. No passwords in code, seeds or this README.
- **Passwords:** argon2id hashes; 12+ characters; lockout after 5 wrong attempts and per-IP rate limits (both off in local development only); unknown usernames take the same time as known ones; every failure shows the same message.
- **Sessions** stored in PostgreSQL; `httpOnly` cookie; 30-minute idle and 12-hour limits; new session ID at sign-in; password changes end other sessions.
- **CSRF token** kept in memory only and required on every write; nothing sensitive in browser storage.
- **Server-side authorization** on every route plus record-level rules; forbidden access is audited.
- **Reset links** are random 256-bit secrets stored only as SHA-256 fingerprints, single use, 30 minutes.
- **Least-privilege database roles**, no deletes of clinical/financial data, append-only audit log protected by triggers.
- **Logs** never contain bodies, cookies, query strings, passwords or patient data.
- **Everything listens on 127.0.0.1** by default; Docker images pinned by digest; dependencies pinned and audited in CI.

---

## 13. Updates from Day 1

### Day 1–2 (2026-10-14): audit and design
- Repository and environment audit.
- Architecture design: requirements, ERD, 11-role permission matrix, state machines, 13 architecture decision records, roadmap (`4320c99`, PR #1).
- Day 3 safeguards documented: nurse session assignments, return checklist, pinned Postgres, styling plan (`a08d322`).

### Day 3 (2026-10-14/15): foundation
- npm workspaces with TypeScript, ESLint, Prettier and Vitest (`ae58fc1`).
- Local PostgreSQL 17.11 in Docker, pinned by digest (`3e6d3a1`).
- README explaining setup, kept up to date from then on (`0110c51`).
- Shared package and API skeleton with settings validation and `/health` (`b275c21`, PR #2).
- Minimal React app with API status and dev proxy (`10915fd`, PR #3).
- Scope clarifications C1–C4: per-operation stock permissions, only Super Admin assigns roles, settings split, audit viewer (`61d30d2`, PR #4).

### Day 4 (2026-10-15): database
- 11 roles reconciled (`2e2ab29`); least-privilege roles `hms_owner` / `hms_app` and migration tooling (`4acbfde`).
- First schema and migrations: identity, settings, append-only audit log (`5eb7e33`).
- Permission map, reference-data seed and the first database tests (`1a483db`, `790a55c`).
- All routes under `/api`, one JSON error shape, request IDs, redacted logging (`973b62f`).
- GitHub Actions CI with a fresh-database job (`09fb7b9`).

### 10-day MVP plan begins (2026-10-17)
- **Day 1 — Authentication:** PostgreSQL sessions, argon2id, lockout, rate limits, CSRF, permission checks, audit library, bootstrap Super Admin (`6732ecc`); login page, protected app shell, permission-based navigation (`2779db2`).
- **Day 2 — Patients and doctors:** patient registration with MRNs and duplicate warning, search, edit; doctor directory; demo data (`99dcda3`).

### 2026-10-18: scheduling and the integrated MVP
- **Scheduling database:** schedules, appointments, no-double-booking constraints, state machine (`d6cc004`).
- **Scheduling API:** availability, booking with locks, walk-ins, check-in tokens, reschedule, doctor-scoped queues (`886d451`).
- Seeds confirm the target database with the server before writing (`cd9f1b7`).
- **Integrated MVP** (`1a0e22f`): role dashboards and unified shell; reception and doctor screens; consultations; pharmacy FEFO dispensing; inventory; laboratory; billing and payments; administration; HR, finance, equipment and outreach; end-to-end workflow tests.

### 2026-10-19: hospital-scale demo and leadership features
- Leave run by HR only; doctor-scoped charts with audited "other doctors' reports"; 15 specialist departments and 20 more doctors; department lab tests; 347-medicine formulary; 189 lab tests and diagnostics; vitals in °F/°C; clearer validation messages (`51b3c1d`).
- Super Admin as CEO (every department's view, read-only pharmacy/lab oversight); sign-in first, then portal cards; connection dot; doctor usernames renamed to first names (`132316c`).

### 2026-10-21 → 10-26: communication hub
- **Notices, staff messages, doctor call requests** with live updates (migrations `0018`–`0019`).
- **Video meetings** with emergency ringing and video calls from any chat (migrations `0020`–`0021`).
- No sign-in limits in local development.

### 2026-10-27: department lookups, conferences, accounts
- **Patient lookup by patient number** in pharmacy, lab and billing (`bf53436`, with the communication hub).
- **Video-call fix:** "Something went wrong" was caused by missing meeting tables on `hms_dev`; migrations applied.
- **Scheduled conferences** with a **Staff heads** invite group; **LiveKit** video server for up to 50 people; **camera flicker fix** (the meeting room was re-joining on every screen update); **emergency alerts** that break through other calls and desktop notifications (`e9c6241`).
- **Only HR creates staff accounts**: public sign-up removed, new `user:create` permission, **Add new staff member** card after sign-in for HR and the Super Admin (`e9c6241`).
- **Own passwords**: change password in the app, forced own password at first sign-in, **forgot password by email link** (Mailpit locally), work email on staff records (migrations `0024`–`0025`).
- **Staff logins that work**: the Add staff member form now requires a username and password, because a staff record saved without a login could not sign in.
- README rewritten (this version): how it works, accounts, and this history.
- **Super Admin gets access to everything**: all 88 permissions, clinical work included (owner decision, `docs/permissions.md` note 13). Applied to `hms_dev` with approval after a verified backup (`hms_dev-20261027-144517-before-sa-full-access.dump`): `db:seed` added the 17 clinical grants (role grants 223 → 240).
- Own passwords, working staff logins, this README and Super Admin full access were committed and pushed together on 2026-10-27.

### Changes to `hms_dev` (all with approval, each after a verified backup)

| Date | Change |
|---|---|
| 2026-10-15 | Roles `hms_owner` / `hms_app`, migrations `0000`–`0001`, reference data |
| 2026-10-17 | Migrations `0002`–`0005`, bootstrap admin, demo data |
| 2026-10-18 | Migrations `0006`–`0016`, permission seed, demo schedules and catalogue |
| 2026-10-19 | Lab tests, doctor usernames, specialists, formulary and department tests, Super Admin grants, migration `0017` |
| 2026-10-21 | Migrations `0018`–`0019`, communication permissions |
| 2026-10-27 | Migrations `0020`–`0025`; permissions `meeting:create` and `user:create`; Super Admin given all 88 permissions |

---

## 14. Known limits and what's next

- **Not built yet:** discounts, refunds and credit notes; dispense returns and substitutions; purchase orders; nurse chart access and emergency (break-glass) access; payroll and shifts; end-of-day job; SMS; imaging.
- **Video:** calls across different networks need a TURN relay (not configured); no recording.
- **Email:** real delivery needs an SMTP provider in `SMTP_URL`; locally everything goes to Mailpit.
- **Live updates** need a single API process.
- **Planned:** per-department PostgreSQL schemas inside the same database; an AI assistant in the communication hub (after the MVP).
- **`npm audit`:** findings in `body-parser` (high) and `ip-address` (moderate) are waiting for an upgrade decision.

---

## 15. Design documents

| Document | Covers |
|---|---|
| [`docs/requirements.md`](docs/requirements.md) | Scope, requirements per role, acceptance criteria |
| [`docs/architecture.md`](docs/architecture.md) | System shape, module rules, conventions |
| [`docs/erd.md`](docs/erd.md) | Tables, keys, constraints, transactions, dispensing algorithm |
| [`docs/permissions.md`](docs/permissions.md) | Role × permission matrix, patient-data access rules, audit rules |
| [`docs/state-machines.md`](docs/state-machines.md) | Lifecycles of appointments, encounters, prescriptions, invoices… |
| [`docs/roadmap.md`](docs/roadmap.md) | The 10-day MVP plan |
| [`docs/adr/`](docs/adr/) | 13 architecture decision records |
