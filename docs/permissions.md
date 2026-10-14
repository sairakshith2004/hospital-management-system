# HospitalOS: permissions and patient-data access

Status: approved design, Day 2 (2026-10-14).

**The server enforces authorization on every request.** It has two layers:
1. `requirePermission(code)` on the route.
2. A record-level check in the service, through the `access` module.

Hiding parts of the UI is a convenience only and is never relied on for security.

## 1. Role codes

| Code | Role |
|---|---|
| SA | Super Admin |
| ADM | Hospital Administrator |
| REC | Receptionist |
| DOC | Doctor |
| NUR | Nurse |
| PHA | Pharmacist |
| LAB | Laboratory Technician |
| FIN | Accountant / Finance Manager |
| HR | HR Manager |
| INV | Inventory / Procurement Manager |
| EQP | Equipment / Maintenance Manager |
| MKT | Marketing Manager |

## 2. Matrix

In this table:
- ● means granted.
- ◐ means granted, but limited by the record-level rules in section 3 or the numbered notes below the table.
- Blank means denied.

| Permission | SA | ADM | REC | DOC | NUR | PHA | LAB | FIN | HR | INV | EQP | MKT |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| user:manage, role:manage | ● | ◐¹ | | | | | | | | | | |
| settings:manage | ● | ● | | | | | | | | | | |
| audit:read | ● | ● | | | | | | | | | | |
| break_glass:review | | ● | | | | | | | | | | |
| day_close:run (manual trigger of the end-of-day job) | | ● | | | | | | | | | | |
| patient:create, patient:update_demographics | | | ● | | | | | | | | | |
| patient:read_demographics | | ● | ● | ● | ● | ◐ | ◐ | ● | | | | |
| patient:read_clinical | | | | ◐ | ◐ | ◐² | ◐² | | | | | |
| allergy:record (allergies and current medications) | | | | ◐ | ◐⁹ | | | | | | | |
| history:write (medical history entries) | | | | ◐ | | | | | | | | |
| schedule:read | | ● | ● | ● | ● | | | | | | | ● |
| schedule:manage, fee:manage, nurse_assignment:manage | | ● | | | | | | | | | | |
| appointment:book, appointment:cancel, appointment:check_in, appointment:mark_no_show, followup:schedule | | | ● | | | | | | | | | |
| queue:read | | ● | ● | ◐ | ◐ | | | | | | | |
| encounter:write, prescription:create, prescription:cancel, lab_order:create, lab_order:cancel, followup:recommend | | | | ◐ | | | | | | | | |
| vitals:record | | | | ◐ | ◐ | | | | | | | |
| medicine:search (read-only) | | ● | | ● | ● | ● | | | | ● | | |
| prescription:dispense, dispense:return, dispense:substitute, prescription:close | | | | | | ● | | | | | | |
| medicine:catalog_manage, stock:adjust | | | | | | ● | | | | ● | | |
| stock:receive | | | | | | ◐³ | | | | ● | | |
| stock:transfer, supplier:manage, po:create | | | | | | | | | | ● | | |
| po:approve | | ● | | | | | | | | | | |
| lab:process (including sample collection), lab_result:enter | | | | | | | ● | | | | | |
| lab_result:verify | | | | | | | ◐⁴ | | | | | |
| invoice:read | | ● | ● | | | ◐⁵ | | ● | | | | |
| invoice:issue, invoice:discard_draft, payment:record, refund:request | | | ● | | | ◐⁵ | | ● | | | | |
| discount:apply (up to the threshold) | | | ● | | | | | ● | | | | |
| discount:approve, refund:approve | | ● | | | | | | ◐⁶ | | | | |
| invoice:void, credit_note:create (manual)⁸, payment:reverse | | | | | | | | ● | | | | |
| price:manage | | ● | | | | | | ● | | | | |
| expense:create | | | | | | | | ● | | | | |
| expense:approve | | ● | | | | | | | | | | |
| report:finance | | ● | | | | | | ● | | | | |
| report:operational | | ● | | | | | | | | | | |
| employee:read | | ● | | | | | | | ● | | | |
| employee:manage, attendance:manage, leave:approve, payroll:manage | | | | | | | | | ● | | | |
| leave:request (own) | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| equipment:manage, maintenance:log | | | | | | | | | | | ● | |
| enquiry:manage | | | ◐⁷ | | | | | | | | | ● |
| campaign:manage | | | | | | | | | | | | ● |
| report:marketing (aggregate only) | | ● | | | | | | | | | | ● |
| break_glass:use | | | | ● | | | | | | | | |

Notes:
1. ADM can't grant or revoke SA, and can't change their own roles. The last active SA can't be disabled.
2. PHA sees only the allergies and current medications of patients whose prescriptions are in the dispensing queue. LAB sees only the clinical details attached to the order. Neither sees clinical notes or diagnoses.
3. PHA can receive goods into a pharmacy location only.
4. The verifier can't be the user who entered the result.
5. PHA's invoice access covers only invoices for visits with dispensing activity.
6. A FIN user can't approve a discount or refund they requested themselves.
7. REC can create enquiries.
8. Manual credit notes need `credit_note:create`. Credit notes created inside another workflow are authorized by that workflow's permission:
   - a dispense return: `dispense:return`
   - a cancellation after check-in: `appointment:cancel`
   - a lab cancellation: `lab_order:cancel`

   The note records its `origin`, and the audit row names the actor.
9. A nurse may record allergies and current medications only for patients covered by the nurse rule in section 3.2 (assigned sessions only). This is the default; recording allergies early at triage improves the dispensing allergy check. Medical history, diagnoses and notes stay doctor-only.

## 3. Patient-data access policy

| Data tier | Contents | Who can see it |
|---|---|---|
| Demographics | MRN, name, age, sex, phone | The roles marked in the matrix. Search returns at most 20 rows and never includes clinical fields. |
| Clinical | History, allergies, medications, diagnoses, notes, vitals, prescriptions, lab results | A doctor with an active care relationship (3.1); a nurse with an active session assignment today (3.2); a doctor holding a valid emergency grant (section 4, read-only); and PHA or LAB within the limited scope in note 2 |
| Financial | Invoices, payments | REC, FIN, ADM, and PHA within the scope in note 5 |

### 3.1 A doctor's routine (care-based) access

A doctor has a care relationship with a patient when **any** of these is true. The windows are read from `hospital_settings` on every request.

1. The patient has an appointment with that doctor in status `booked`, `checked_in` or `in_consultation`, with `visit_date` between today and `today + care_window_before_days` (default 7). This allows reviewing the chart before the visit.
2. The doctor has an encounter with the patient that is `in_progress`, or that was completed within `care_window_after_days` (default 90). This covers results review and continuity of care.
3. The doctor is the `target_doctor_id` of a follow-up for that patient that is `pending` or `booked`.
4. The doctor ordered a lab test for the patient that was verified within the last `care_window_after_days`.

**What a care relationship allows:**
- Reading the patient's full chart, including entries by other doctors. A treating doctor needs the patient's whole history.
- Writing only inside that doctor's own `in_progress` encounter.

There is **no lifetime access**. When every condition has lapsed, routine access ends.

### 3.2 A nurse's access

A nurse can access a patient only through an **active assignment** for today's doctor session.
- **Who assigns:** an administrator, with `nurse_assignment:manage`, by creating a row in `nurse_assignments`.
- **Which patients:** those with an appointment today in an assigned session (matched on `appointments.doctor_schedule_id`), in status `checked_in` or `in_consultation`.
- **What the nurse can do:** read the chart, record vitals for that visit, and record allergies and current medications (note 9).
- **Department isn't enough:** belonging to the same department doesn't grant access.
- **Revocation:** revoking an assignment ends access on the next request.
- **Audit:** every grant and revocation is audited.

### 3.3 Everyone else

No other role has access to clinical data.

## 4. Emergency (break-glass) access

**Purpose:** a doctor can read a chart when it's clinically necessary but no routine care relationship exists.

**Request requirements:**
- a reason category (emergency, covering_colleague, transferred_care or other)
- a documented reason of at least 20 characters
- the user's password, re-entered

**What a grant gives:**
- Read-only access to **one patient** for `break_glass_hours` (default 4).
- Access ends sooner if an administrator revokes it.
- Writing clinical data still needs a real encounter. A doctor who has to treat the patient registers a walk-in or appointment, which creates a routine care relationship immediately.

**No hard cap.** The number of grants a user holds is never used to refuse emergency access. Instead:
- When a user goes over `break_glass_alert_threshold` grants (default 3) in 24 hours, every grant over the threshold is marked `priority_review = true`.
- Those grants are shown first in the administrator's review queue.

**What gets audited:**
- `break_glass.granted` and `break_glass.revoked`.
- Every read made under a grant, tagged with `break_glass_grant_id`.

**Review:**
- Every grant stays in the ADM review queue until it's reviewed.
- The review records an outcome (`appropriate` or `inappropriate`), a note, the reviewer and the time.
- The reviewer can't be the person who used the grant.
- Grants older than 72 hours that haven't been reviewed are highlighted on the ADM dashboard.

**Who can use it:** doctors only, in this outpatient MVP. Extending it to nurses is a configuration change, recorded in ADR 0005.

## 5. Audit requirements

**Events audited:**
- `patient.clinical.read` on every clinical read. If the audit write fails, no data is returned.
- Every create, update or status change on: patients, appointments, encounters, notes, prescriptions, dispensings, dispensing returns, stock movements, stock transfers, invoices, discounts, payments, refunds, credit notes, nurse assignments, users, roles and settings.
- Login success, login failure and lockout.
- `access.denied`.
- Every day-close transition, recorded with `actor_type = system`.

**Each audit row contains:**
- the actor (a user, or the system for day-close), action and entity
- the patient ID, where relevant
- the emergency grant ID, if access was through a grant
- the request ID and IP
- the names of the changed fields

Values of sensitive fields are never stored, and passwords and tokens never appear.

**Rules:**
- Denied requests return a generic 403 that doesn't reveal why.
- The application's database role can only insert into `audit_logs`.

## 6. Hard restrictions (each has an automated test)

- **Doctors and pharmacy stock:** DOC has no stock or dispensing permission, so medicine search is read-only for doctors.
- **Pharmacist limits:** PHA can't create prescriptions, and dispenses only against `issued` or `partially_dispensed` prescriptions.
- **Dispensing safety:** expiry rules, substitution rules and stock availability are all enforced on the server inside the dispensing transaction.
- **Substitution:** requires the prescriber's flag, equivalence computed by the server, the pharmacist's verification, and the `dispense:substitute` permission.
- **Discounts:** a cumulative discount above `discount_limit_bp` (default 10%) needs approval from a different user with `discount:approve`. The full discount trail is stored in `invoice_discounts`.
- **Billing corrections:**
  - Voids, draft discards, credit notes and refunds require a reason.
  - Manual credit notes are FIN-only. Workflow credit notes follow note 8.
  - A refund is approved by someone other than its requester.
  - Nothing financial can be deleted.
- **Finance:** expenses are approved by someone other than their creator.
- **Administration:**
  - ADM can't escalate their own privileges or manage SA.
  - SA has no access to patient data.
- **No patient data:** HR, INV, EQP and MKT have no access to patient data, and MKT sees only aggregate conversion numbers.
- **Nurses:** no clinical access without an active, administrator-made session assignment.
