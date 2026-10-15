# HospitalOS: permissions and patient-data access

Status: approved design, Day 2 (2026-10-14). Amended 2026-10-15 for scope clarifications C1 (stock operations), C2 (role management), C3 (settings) and C4 (audit viewer); see [`requirements.md`](requirements.md).

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
| INV | Inventory / Procurement Manager (also holds the equipment and maintenance permission group) |

**The approved product role model is exactly these 11 roles.** The existing code hasn't been reconciled yet: `ROLE_CODES` in `packages/shared/src/index.ts` still has 12 entries, including `EQP`, and its test expects 12. Nothing uses it, and no role enforcement or role seeding exists yet. Reconciling it to these 11 roles is scheduled as the **first step of Day 4, before role seeding or role enforcement is implemented**.
| MKT | Marketing Manager |

## 2. Matrix

In this table:
- ● means granted.
- ◐ means granted, but limited by the record-level rules in section 3 or the numbered notes below the table.
- Blank means denied.

| Permission | SA | ADM | REC | DOC | NUR | PHA | LAB | FIN | HR | INV | MKT |
|---|---|---|---|---|---|---|---|---|---|---|---|
| user:manage (staff accounts: create, deactivate, reset password; no role changes) | ● | ◐¹ | | | | | | | | | |
| user_role:assign (grant or revoke a user's roles) | ◐¹ | | | | | | | | | | |
| role:manage (role definitions and role-permission assignments) | ◐¹ | | | | | | | | | | |
| system_settings:manage, security_settings:manage | ◐¹¹ | | | | | | | | | | |
| operational_settings:manage | | ◐¹¹ | | | | | | | | | |
| department:manage | | ● | | | | | | | | | |
| audit:read | ◐¹⁰ | ● | | | | | | | | | |
| break_glass:review | | ● | | | | | | | | | |
| day_close:run (manual trigger of the end-of-day job) | | ● | | | | | | | | | |
| patient:create, patient:update_demographics | | | ● | | | | | | | | |
| patient:read_demographics | | ● | ● | ● | ● | ◐ | ◐ | ● | | | |
| patient:read_clinical | | | | ◐ | ◐ | ◐² | ◐² | | | | |
| allergy:record (allergies and current medications) | | | | ◐ | ◐⁹ | | | | | | |
| history:write (medical history entries) | | | | ◐ | | | | | | | |
| schedule:read | | ● | ● | ● | ● | | | | | | ● |
| schedule:manage, fee:manage, nurse_assignment:manage | | ● | | | | | | | | | |
| appointment:book, appointment:cancel, appointment:check_in, appointment:mark_no_show, followup:schedule | | | ● | | | | | | | | |
| queue:read | | ● | ● | ◐ | ◐ | | | | | | |
| encounter:write, prescription:create, prescription:cancel, lab_order:create, lab_order:cancel, followup:recommend | | | | ◐ | | | | | | | |
| vitals:record | | | | ◐ | ◐ | | | | | | |
| medicine:search (read-only) | | ● | | ● | ● | ● | | | | ● | |
| prescription:dispense, dispense:return, dispense:substitute, prescription:close | | | | | | ● | | | | | |
| medicine:catalog_manage | | | | | | ● | | | | ● | |
| stock:adjust_pharmacy | | | | | | ◐³ | | | | | |
| stock:adjust_store | | | | | | | | | | ◐³ | |
| goods_receipt:create (supplier receipts) | | | | | | | | | | ◐³ | |
| stock_transfer:dispatch_pharmacy (create, dispatch, cancel from a pharmacy) | | | | | | ◐³ | | | | | |
| stock_transfer:dispatch_store (create, dispatch, cancel from the general store) | | | | | | | | | | ◐³ | |
| stock_transfer:receive_pharmacy (accept or reject into a pharmacy; accept returns into a pharmacy) | | | | | | ◐³ | | | | | |
| stock_transfer:receive_store (accept or reject into a store; accept returns into a store) | | | | | | | | | | ◐³ | |
| supplier:manage, po:create | | | | | | | | | | ● | |
| po:approve | | ● | | | | | | | | | |
| lab:process (including sample collection), lab_result:enter | | | | | | | ● | | | | |
| lab_result:verify | | | | | | | ◐⁴ | | | | |
| invoice:read | | ● | ● | | | ◐⁵ | | ● | | | |
| invoice:issue, invoice:discard_draft, payment:record, refund:request | | | ● | | | ◐⁵ | | ● | | | |
| discount:apply (up to the threshold) | | | ● | | | | | ● | | | |
| discount:approve, refund:approve | | ● | | | | | | ◐⁶ | | | |
| invoice:void, credit_note:create (manual)⁸, payment:reverse | | | | | | | | ● | | | |
| price:manage | | ● | | | | | | ● | | | |
| expense:create | | | | | | | | ● | | | |
| expense:approve | | ● | | | | | | | | | |
| report:finance | | ● | | | | | | ● | | | |
| report:operational | | ● | | | | | | | | | |
| employee:read | | ● | | | | | | | ● | | |
| employee:manage, attendance:manage, leave:approve, payroll:manage | | | | | | | | | ● | | |
| leave:request (own) | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| equipment:manage, maintenance:log | | | | | | | | | | ● | |
| enquiry:manage | | | ◐⁷ | | | | | | | | ● |
| campaign:manage | | | | | | | | | | | ● |
| report:marketing (aggregate only) | | ● | | | | | | | | | ● |
| break_glass:use | | | | ● | | | | | | | |

Notes:
1. Account and role management (C2):
   - ADM creates, deactivates and resets passwords for staff accounts, but not SA accounts and not their own account status. ADM can't grant or revoke roles or change role permissions.
   - **Onboarding dependency:** a new account starts with no roles, so it holds no permissions. It can log in, change its own password and log out, and every protected route returns 403 until SA assigns a role. SA's user list flags accounts awaiting role assignment. A role grant takes effect on the user's next request (AD-8).
   - SA grants and revokes users' roles and changes role permissions.
   - **No user, including SA, can change their own role assignments or the permissions of a role they hold.** Every SA holds the SA role, so the SA role's permissions are fixed by the seed.
   - The last active SA can't be disabled or lose the SA role.
   - Every account, role or permission change needs a reason and is audited (section 5).
2. PHA sees only the allergies and current medications of patients whose prescriptions are in the dispensing queue. LAB sees only the clinical details attached to the order. Neither sees clinical notes or diagnoses.
3. Stock permissions are separate per operation **and** scoped by the kind of location affected (C1). The service checks both on the server, after locking the batch or transfer:

   | Operation | Permission | Holder | Allowed location kind |
   |---|---|---|---|
   | Dispense against a prescription | `prescription:dispense` | PHA | `pharmacy` |
   | Adjust stock in a pharmacy | `stock:adjust_pharmacy` | PHA | `pharmacy` |
   | Adjust stock in the general store | `stock:adjust_store` | INV | `store` |
   | Receive goods from a supplier | `goods_receipt:create` | INV | `store` only |
   | Create, dispatch or cancel a transfer out of a pharmacy | `stock_transfer:dispatch_pharmacy` | PHA | source `pharmacy` |
   | Create, dispatch or cancel a transfer out of the general store | `stock_transfer:dispatch_store` | INV | source `store` |
   | Accept or reject a transfer into a pharmacy | `stock_transfer:receive_pharmacy` | PHA | destination `pharmacy` |
   | Accept or reject a transfer into a store | `stock_transfer:receive_store` | INV | destination `store` |
   | Accept a rejected transfer back | the source's receipt permission | PHA or INV | source |

   Dispatch is checked against the transfer's **source** and receipt against its **destination**. A transfer moves no stock into the destination until a holder of the destination's receipt permission explicitly accepts it. That user must be different from the dispatcher, and the same applies to rejection. After a rejection, the return is recorded at the source by a user who is neither the dispatcher nor the rejecter. The full lifecycle is in [`state-machines.md`](state-machines.md) section 5. Any other combination returns 403 and writes `access.denied`. "Adjustment" means the movement kinds `adjustment_in`, `adjustment_out`, `damage` and `expiry_writeoff`. Each needs a reason, and the movement records the actor, timestamp, location, batch and signed quantity (ERD section 3.5).
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
10. SA's audit viewer (C4) shows audit metadata (time, actor, action, entity, request ID, IP, changed field names, reason) and patient identifiers (patient ID and MRN). It never shows patient names, contact details or other demographics. Audit rows never contain clinical note contents. Every audit-log search writes exactly one `audit_log.searched` row, recording the searcher and filters. That row is written directly by the audit-viewer service, never by the generic audit hook, so writing it or later reading it never produces further audit rows.
11. Settings are split by permission (C3). Each `hospital_settings` key belongs to exactly one permission (ERD section 3.1). SA changes system and security settings; ADM changes only the explicitly allowlisted operational settings. The key-to-permission map lives in `packages/shared` and the server enforces it on every settings request; the UI hiding a field is never relied on. A key outside the caller's permission returns 403, and an unknown key returns 422. There is no general-purpose settings permission.

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
- **Stock operations** (C1), each a distinct action:
  - `stock.adjusted`, with the actor, batch, location, movement kind and reason. The movement itself stores the signed quantity and resulting balance.
  - `goods_receipt.created`, `stock_transfer.dispatched`, `stock_transfer.received`, `stock_transfer.rejected`, `stock_transfer.returned`, `stock_transfer.cancelled`, `dispensing.created`.
- **Sensitive administrative changes** (C2, C3), each with a required reason:
  - `user.created`, `user.status_changed`, `user.password_reset`
  - `user_role.granted`, `user_role.revoked`
  - `role_permission.granted`, `role_permission.revoked`
  - `settings.changed`

  Each row names the actor, target user (or role, or setting key), action and reason. For these events `changes` records the role or permission code granted or revoked, or the setting's old and new value. These values aren't sensitive, so this is the one place `changes` holds values rather than only field names.
- **Audit-log searches:** one `audit_log.searched` row per search, with the filters used (C4). It is never itself audited again (note 10).
- Login success, login failure and lockout.
- `access.denied`.
- Every day-close transition, recorded with `actor_type = system`.

**Each audit row contains:**
- the actor (a user, or the system for day-close), action and entity
- the patient ID, where relevant
- the emergency grant ID, if access was through a grant
- the request ID and IP
- the names of the changed fields
- the reason, where one is required

Values of sensitive fields are never stored, and passwords and tokens never appear.

**Rules:**
- Denied requests return a generic 403 that doesn't reveal why.
- The application's database role can only insert into `audit_logs`.
- **The audit log can't be altered or deleted by anyone through the application**, including SA. There is no permission or API route for it, and a trigger blocks UPDATE and DELETE on `audit_logs` (ADR 0011).
- `audit:read` (SA and ADM) shows audit rows as stored. SA's view is limited by note 10: patient ID and MRN, never names, contacts, other demographics or clinical content.

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
  - ADM can't escalate their own privileges, manage SA accounts, assign roles or change role permissions.
  - No user, including SA, can change their own role assignments or the permissions of a role they hold.
  - SA has no access to patient data beyond the identifiers in note 10, and holds no operational permissions (dispensing, billing, stock, scheduling, operational settings).
  - Settings changes are limited to each permission's own keys (note 11).
  - Nobody can alter or delete audit rows (AD-5).
- **Stock operations:** dispensing, pharmacy adjustments, general-store adjustments, supplier goods receipts, transfer dispatch and transfer receipt each need their own permission, checked against the source or destination location kind (note 3). Every adjustment has a reason and an audit row (ST-1 to ST-8).
- **No patient data:** HR, INV and MKT have no access to patient data, and MKT sees only aggregate conversion numbers.
- **Nurses:** no clinical access without an active, administrator-made session assignment.
