# HospitalOS: 10-day MVP plan

Status: approved 2026-10-17. Replaces the 30-day roadmap (kept in git history). Day 1 is 2026-10-17; Day 10 is 2026-10-26.

The goal is a polished, tested **outpatient** MVP for one multispecialty hospital with a real React interface, a real PostgreSQL database, authenticated staff accounts and server-side permissions. It is not a production-ready hospital ERP.

## Primary workflow (must work end to end)
Reception registers or finds a patient → books an appointment or a walk-in → the patient appears in the doctor's queue → the doctor sees the authorized history and records vitals, notes, diagnoses, prescriptions and a follow-up → the doctor can view (not change) pharmacy stock → the pharmacist dispenses (batch-aware, transactional, never expired or insufficient stock) → billing invoices and records payments → dashboards show the real records. Basic lab is added if time allows.

## Working cadence
- One plan approval per phase; approved non-destructive work (writing code, tests, lint, typecheck) then runs without further stops.
- One combined approval per day for that day's migration and seed (applied to `hms_dev` and `hms_test`) and the end-of-day push.
- Dependency installs are grouped and approved separately; credentials and destructive operations always need explicit approval.

## Schedule
| Day | Deliverables | Acceptance |
|---|---|---|
| 1 | Sessions, login/logout/me, lockout, CSRF, `requirePermission`, audit library, bootstrap admin (1A). Web foundation: router, data fetching, Tailwind and components, login page, protected shell, 401/403/expired states (1B). | Login through the UI; generic failures; lockout; CSRF 403; disabled user rejected; role-less user 403; tests for each. |
| 2 | Departments, doctor profiles (specialty, one consultation fee), patients (MRN, demographics), trigram search, demo seed with one account per role. Patient search, registration and edit UI; doctor list. Allergies move to Day 4 (only DOC and NUR may record them). | Reception registers, finds and edits synthetic patients; duplicate check; validation; permission tests. |
| 3 | Weekly schedules, availability, appointments with a database overlap constraint, walk-in tokens, check-in, cancel, no-show, queues. Booking and queue UI. | Concurrent double-booking is refused (parallel test); checked-in patients appear in the right queue. |
| 4 | Encounters: vitals, diagnoses, notes, prescriptions, follow-up. Access rule: a doctor sees only patients with an appointment with them. Doctor workspace UI. | Cross-doctor access is 403 and audited; completed notes are read-only; prescriptions reach pharmacy. |
| 5 | Ingredients, products (brand, strength, form), batches by location and expiry, append-only movements, dispensing (row locks, earliest expiry first, no expired or insufficient stock). Pharmacy UI; read-only stock search for doctors. | Concurrent dispensing can't oversell; stock can't go negative (CHECK); expired batches never chosen; doctors can't write stock. |
| 6 | Invoices per visit (consultation fee; dispensing adds lines in the same transaction), gapless numbers, payments (cash, card, UPI, partial). Lab order → result → doctor view if time. | Exact totals; payments can't exceed the balance; lab either tested or explicitly deferred. |
| 7 | Dashboards for reception, doctor, pharmacist, billing and admin from SQL aggregates; permission-based navigation; full UI flow. | No hard-coded figures; loading, empty and error states everywhere. |
| 8 | User administration (create, disable, reset password, assign roles), goods receipt with supplier, low-stock and near-expiry lists, audit-log viewer, settings view. | Permission-tested; receipts write stock movements. |
| 9 | End-to-end API workflow test, every route × every role, security pass, bug fixing. | All suites green in CI. |
| 10 | Final checks, backup and restore drill into a new scratch database, demo seed, README and demo script; deployment only if Day 9 finished on time. | Definition of done met from a fresh clone. |

## Scope
| Area | Full | Simplified | Deferred |
|---|---|---|---|
| Auth and access | sessions, lockout, CSRF, permissions, audit | care rule = has an appointment with this doctor | break-glass access, nurse-assignment rule |
| Patients | registration, search, demographics, allergies | duplicates by phone + name | record merge, attachments |
| Scheduling | schedules, availability, booking, walk-ins, queue | weekly template; no leave or holidays | automatic day-close job, SMS |
| Clinical | vitals, notes, diagnoses, prescriptions, follow-up | diagnosis codes as free text | addenda, templates |
| Pharmacy | catalogue, batches, FEFO dispensing, movements, doctor read-only view | no substitution; stock in by receipt | returns, transfers, purchase orders, cold-chain rules |
| Billing | invoices, payments, gapless numbers | no or one capped discount | refunds, credit notes, voids (Day 8 if time) |
| Lab | order → result → doctor view (if time) | no sample tracking or second verifier | PDF report |
| Admin | users, roles, audit viewer, settings view | — | role editor |
| HR, finance, equipment, marketing | — | finance = billing collection reports | all deferred; no placeholder pages |

## If a day slips
Cut in this order: Day 8 extras → lab → deployment (local demo instead) → dashboard polish. Never cut: authentication, authorization tests, dispensing and stock integrity, billing correctness, the backup drill.

## Definition of done (primary workflow)
From a fresh clone with migrations, the demo seed and `dev`, using synthetic data only:
1. Reception logs in, finds or registers a patient, sees availability and books (or registers a walk-in); a conflicting booking is refused.
2. After check-in the patient is in that doctor's queue.
3. The doctor opens only their own patients (another doctor gets an audited 403), records vitals, diagnoses, notes, a prescription and a follow-up, and sees stock by ingredient, brand, strength, form, batch, expiry and location without being able to change it.
4. The pharmacist dispenses; stock drops on the earliest-expiry valid batch with a movement row; expired or insufficient stock is refused; concurrent dispensing can't oversell.
5. Billing shows consultation and medicine lines, records a payment, totals are exact and invoice numbers have no gaps.
6. Every dashboard shows these records.
7. Every endpoint returns 401 without a session and 403 without permission (route × role test); logins, denials and every change are audited; logs contain no personal data or secrets.
8. CI is green: lint, typecheck, unit tests, database tests and the end-to-end API workflow test.
