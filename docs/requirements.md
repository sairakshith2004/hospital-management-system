# HospitalOS: MVP requirements

Status: approved design, Day 2 (2026-10-14).

## 1. Context

HospitalOS serves one multispecialty hospital, **outpatient-only**, with 11 staff roles.

This is a **synthetic-data demonstration**. It has not been assessed against India's DPDP Act and Rules or clinical-records requirements, and must not hold real patient data without qualified legal, clinical and security review.

The system never diagnoses patients or recommends treatment. Allergy matching and product-equivalence checks are factual data comparisons, not clinical decision support.

## 2. Recorded scope decisions (2026-10-14)

| ID | Decision |
|---|---|
| D1 | Local PostgreSQL 17 runs in Docker. |
| D2 | Scope is tiered (section 4). |
| D3 | npm workspaces: `apps/api`, `apps/web`, `packages/shared`. |
| D4 | Server-side sessions stored in Postgres, with httpOnly cookies. |
| D5 | Money is stored as integer paise. |
| D6 | Doctors get care-based record access, plus audited emergency access. |
| D7 | Dispensing adds lines to the visit's open (draft) invoice in the same transaction. |
| D8 | Managed hosting and managed Postgres. The provider is confirmed on Day 5. |
| D9 | One feature branch per phase, merged by pull request, with CI. |
| Q1 | Outpatient-only. Inpatient admissions, beds, wards, discharge and emergency triage are deferred. |
| Q2 | The consultation fee is charged at check-in. It is configurable per doctor and visit type, falling back to the service price. Payments are recorded and balances can stay outstanding; care never waits for payment. |
| Q3 | Routine access is care-based, server-side and time-limited (7 days before and 90 days after a visit, configurable). Emergency (break-glass) access requires a documented reason and is audited and reviewed. **There is no hard cap on emergency grants**; unusual volume is flagged for review instead. |
| Q4 | Billing staff may discount up to a **configurable** threshold, 10% by default, measured cumulatively per invoice. Anything above it needs approval from an authorized person other than the requester. The full discount trail is recorded. |
| Q5 | The server blocks expired stock, warns for batches expiring within 30 days (acknowledgement required), and blocks batches that would expire before the treatment course ends. |
| Q6 | Substitution needs the prescriber's permission and the pharmacist's verified equivalence of ingredient, strength, dosage form and route. Both the prescribed and dispensed products are recorded. There are no automated recommendations. |
| Q7 | One outpatient pharmacy and one general store, extensible to more. Stock transfers are modelled; building the full transfer workflow is deferred if time is short. |
| Lab | Laboratory is Tier 2. |

**Approved safeguards (2026-10-14)**

| ID | Safeguard |
|---|---|
| S1 | Returned medicines must satisfy documented return, packaging, traceability and storage requirements before restocking. Expired, recalled, opened, improperly stored or otherwise ineligible medicine is never restocked. There's a configurable 7-day return window. Cold-chain items aren't restocked unless an explicitly approved, documented policy establishes that the cold chain stayed intact. |
| S2 | Nurse permissions follow least privilege and assigned-patient access: administrator-managed session assignments, enforced on the server and audited. |
| S3 | The 23:30 end-of-day job is idempotent, configurable and safe to rerun. |
| S4 | Completed clinical notes are immutable. Corrections are appended as audited addenda. |
| S5 | Tier 3 is deferred whenever core-workflow completion, security or testing is at risk. |

**Approved scope clarifications (2026-10-15)**

| ID | Clarification |
|---|---|
| C1 | **Stock operations.** Dispensing, pharmacy stock adjustments, general-store stock adjustments, supplier goods receipts and transfer receipts are separate operations, each with its own server-enforced permission checked against the location kind. Transfers are authorized by operation and by source or destination location: pharmacists dispatch from a pharmacy and Inventory / Procurement Managers dispatch from the general store, and the receiving location must explicitly accept or reject every transfer, always by a different user from the dispatcher. A rejected transfer returns to its original source batches through an audited return, so stock is never created, lost or duplicated. Pharmacists dispense, manage pharmacy stock, and accept transfers into a pharmacy only through an explicit transfer-receipt permission. Inventory / Procurement Managers handle supplier purchase-order receipts and goods receipts into the general store, and general-store stock. Every adjustment records the actor, timestamp, reason, batch, location and quantity change. |
| C2 | **Role management.** Only Super Admin assigns users' roles and changes role permissions; Hospital Administrators don't hold `role:manage`. A new account has no access to protected functions until Super Admin assigns a role. No user, including Super Admin, can change their own role assignments or grant themselves permissions. Role and other sensitive permission changes need a justification, and the audit row records the actor, target user, action, reason and the role or permission involved. Operational permissions are kept separate from system administration. |
| C3 | **Settings.** System-wide and security-sensitive settings (Super Admin) are separate from explicitly authorized operational settings (Hospital Administrator). There's no general-purpose settings permission. The server enforces the split on every change, and every change is audited. |
| C4 | **Audit viewer.** Authorized audit viewers see patient identifiers (including MRN where needed) and relevant audit metadata, but no clinical note contents or unnecessary patient details. Audit-log searches are recorded without creating recursive audit events. Audit records can't be altered or deleted, and sensitive access and administrative changes are audited. |

The project has exactly 11 roles (listed in [`permissions.md`](permissions.md) section 1). This is the approved product role model. The existing code's role list (12 entries) hasn't been reconciled yet; that's scheduled for the start of Day 4, before role seeding or enforcement is implemented. Equipment and maintenance is a permission group held by the Inventory / Procurement Manager, not a separate role. These clarifications add granular permissions, not roles.

## 3. Functional requirements by role

- **Receptionist (REC)**
  - Register and search patients; record contacts and consents.
  - View doctor availability.
  - Book, cancel and reschedule appointments; check in patients; register walk-ins; run the queue.
  - Schedule recommended follow-ups.
  - Issue invoices, record payments, apply discounts within the threshold.
  - Create enquiries.
- **Doctor (DOC)**
  - See their own queue and upcoming appointments.
  - Read the charts of patients in their care.
  - Record vitals, symptoms, observations, diagnoses, clinical notes and treatment plans.
  - Create prescriptions, marking each item as substitutable or not.
  - Order lab tests and review results.
  - Recommend follow-ups.
  - Look up medicine availability (read-only).
  - Use emergency access.
- **Nurse (NUR)**
  - See and work on patients in the doctor sessions they're assigned to today. An administrator makes the assignments; there's no department-wide access.
  - Record vitals for a checked-in patient in an assigned session, including before the doctor starts the consultation.
  - Record allergies and current medications for those patients.
  - Read those patients' charts.
- **Pharmacist (PHA)**
  - Work the dispensing queue: check prescriptions and allergies, dispense (including verified substitution), process returns.
  - Manage pharmacy stock: adjust stock in pharmacy locations only, with a reason (C1).
  - Manage the medicine catalogue and batches.
  - Dispatch authorized transfers out of the pharmacy, and explicitly accept transfers into it (C1). Supplier goods receipts are INV's.
  - Issue pharmacy invoices and record payments.
- **Laboratory technician (LAB)**
  - Work the order list.
  - Record sample collection and enter results.
  - Verify results entered by someone else.
  - Print reports.
- **Finance (FIN)**
  - Manage invoices, payments, credit notes and refunds.
  - Apply discounts, and approve those requested by others.
  - Record expenses.
  - Run financial reports.
- **HR**
  - Manage employees, attendance, shifts and leave approvals.
  - Keep manual payroll records.
- **Inventory (INV)**
  - Manage suppliers and purchase orders, and receive supplier goods into the general store (C1).
  - Maintain the catalogue.
  - Manage general-store inventory, including stock adjustments in general-store locations (C1).
  - Dispatch authorized transfers out of the general store, and explicitly accept transfers into it (C1).
  - Maintain the equipment register, maintenance schedules and logs, and downtime (the equipment permission group).
- **Marketing (MKT)**
  - Manage enquiries, campaigns, referral sources and consent records.
  - View aggregate conversion reports.
- **Hospital administrator (ADM)**
  - Manage departments, schedules, fees and the allowlisted operational settings (C3).
  - Create, deactivate and reset passwords for staff accounts (not Super Admin accounts). Can't assign roles or change role permissions (C2); a new account waits for Super Admin to assign its role.
  - Manage nurse session assignments.
  - Approve purchase orders, expenses, discounts and refunds.
  - Review emergency access.
  - Run the end-of-day job manually when needed.
  - Read the audit log and run operational reports.
- **Super Admin (SA)**
  - View and manage users, assign users' roles, and manage role permissions (C2), never for their own account or roles they hold.
  - Manage system-wide and security settings (C3).
  - Read the audit log, with patient identifiers but no clinical content (C4). **Can't alter or delete it**; no role can.
  - **Has no access to patient data.** Operational work (dispensing, billing, stock, scheduling, operational settings) isn't part of the role.

## 4. Scope tiers

| Tier | In the MVP |
|---|---|
| 1 | Auth, RBAC, audit, emergency access · patients · departments, doctors, schedules, fees · appointments, walk-ins, queue · encounters · prescriptions · follow-ups · medicine catalogue, batches, availability search, dispensing, substitution, returns, adjustments · billing (discounts, payments, credit notes, refunds) · dashboards for REC, DOC, PHA, ADM and FIN |
| 2 | Laboratory · suppliers, purchase orders, goods receipts · general inventory · stock transfers (modelled; full workflow if time allows) · PDFs for invoices, receipts and lab reports |
| 3 (thin) | Employees, attendance, leave, manual payroll · expenses with approval · equipment and maintenance · enquiries, campaigns, consent, conversion report |

**Deferred:**
- Inpatient care: admissions, beds, wards, discharge
- Emergency triage
- Sending reminders by SMS, WhatsApp or email
- Radiology, PACS and device interfaces
- ABDM and ABHA integration
- Insurance and TPA claims
- Statutory payroll, GST filing and the general ledger
- Patient portal
- Patient record merging
- Purchase-request approval chains
- Multiple hospitals

## 5. Acceptance criteria

Each criterion has an ID that tests and the roadmap refer to.

### Patient registration (PR)
- **PR-1:** Registering a patient produces a unique MRN.
- **PR-2:** Registration warns about a possible duplicate with the same phone number and date of birth.
- **PR-3:** Invalid input is rejected with errors per field.
- **PR-4:** Editing demographics writes an audit row listing the changed field names.

### Scheduling (SC)
- **SC-1:** Available slots exclude breaks, leave, blocked times, holidays, past times and booked slots.
- **SC-2:** A schedule change doesn't alter existing bookings; any conflicts are listed for review.

### Booking (BK)
- **BK-1:** Booking a free slot succeeds.
- **BK-2:** If 10 booking requests for one slot arrive at once, exactly 1 succeeds and 9 get 409.
- **BK-3:** Booking beyond `max_bookings` is rejected.
- **BK-4:** A reschedule keeps the old row as `rescheduled` and links it to the new one.
- **BK-5:** A slot freed by a cancellation can be booked again.

### Queue (QU)
- **QU-1:** Check-in assigns a sequential token for that doctor and day.
- **QU-2:** The queue is ordered by token and shows each patient's waiting time.
- **QU-3:** A walk-in enters the queue without needing a slot.
- **QU-4:** A nurse records vitals for a `checked_in` appointment before any encounter exists. The doctor sees them in the encounter.

### End-of-day job (JB)
- **JB-1:** The job moves `booked` appointments from earlier days to `no_show`, and their linked booked follow-ups to `missed`.
- **JB-2:** The job moves `pending` follow-ups whose `due_to + follow_up_grace_days` has passed to `missed`.
- **JB-3:** The job closes `issued` or `partially_dispensed` prescriptions older than `prescription_validity_days`.
- **JB-4:** Running the job twice, or concurrently, produces the same result as running it once. Every transition writes an audit row with `actor_type = system`.
- **JB-5:** Only users with `day_close:run` can trigger it manually.
- **JB-6:** With `day_close_enabled = false`, the scheduled run is skipped and logged. A manual run with `day_close:run` still works and stays idempotent.

### Consultation fees (CF)
- **CF-1:** Check-in adds the fee from `doctor_fees` (doctor, visit type, effective date). If there isn't one, it uses the department's consultation service price.
- **CF-2:** Retrying check-in never adds the fee twice.
- **CF-3:** Changing a fee later doesn't alter invoice lines that already exist.
- **CF-4:** Check-in, consultation, lab orders and dispensing never require payment first. This is tested as each of those workflows is built (roadmap days 14, 16 and 19).
- **CF-5:** A patient's account shows the outstanding balance (issued invoices) separately from unbilled draft charges.

### Patient-data access (AX)
- **AX-1:** A doctor with an active appointment for the patient, inside the configured window, can read the chart.
- **AX-2:** A doctor whose only link is an encounter completed outside `care_window_after_days` gets 403, and an `access.denied` audit row is written.
- **AX-3:** A doctor who is the target of the patient's pending or booked follow-up can read the chart.
- **AX-4:** Emergency access:
  - It is rejected without a reason category, without a reason text of at least 20 characters, or without correct password re-entry.
  - A valid request gives read-only access for the configured duration and writes a `break_glass.granted` audit row.
  - The grant appears in the review queue.
- **AX-5:** An expired or revoked grant returns 403.
- **AX-6:** Emergency access does not permit creating clinical records; attempting to returns 403.
- **AX-7:** A nurse without an active assignment for the patient's session gets 403, even within the same department.
- **AX-8:** Every clinical read writes a `patient.clinical.read` audit row. If that audit write fails, no data is returned.
- **AX-9:** SA, HR, INV and MKT get 403 on every patient-data endpoint.
- **AX-10:** A doctor with many active emergency grants can still obtain another one. Going over `break_glass_alert_threshold` grants in 24 hours marks the grants for priority review, but never blocks access.
- **AX-11:** Changing the care-window settings changes access decisions immediately, with no code change.
- **AX-12:** A doctor who ordered a lab test for the patient that was verified within `care_window_after_days` can read the chart. A doctor whose only link is such an order verified outside that window gets 403.
- **AX-13:** Assigning and revoking nurse assignments requires `nurse_assignment:manage` and is audited. A revoked assignment ends access on the next request. A walk-in outside every session isn't visible to nurses.

### Consultation (CN)
- **CN-1:** Vitals, diagnoses and notes are saved. Completing the encounter completes the appointment in the same transaction.
- **CN-2:** While an encounter is `in_progress`, its notes and diagnoses can be edited, and each edit is audited. Once it's completed, edits are blocked by the database and only addenda are accepted.
- **CN-3:** Marking an encounter `entered_in_error` returns its appointment to `checked_in` in the same transaction.

### Prescriptions and availability (RX)
- **RX-1:** Searching by ingredient, generic name, brand, strength or dosage form returns each product separately. Each result shows:
  - brand, strengths, form and route
  - sellable stock (active, unexpired, at the pharmacy)
  - nearest expiry
  - location
  - availability status
  - time of the last stock movement
- **RX-2:** Paracetamol 500 mg tablets, paracetamol 650 mg tablets and paracetamol syrup appear as different products.
- **RX-3:** No doctor-accessible route changes stock.
- **RX-4:** Prescribing a medicine containing an ingredient the patient is recorded as allergic to needs an explicit acknowledgement, and the acknowledgement is stored.

### Dispensing (DP)
- **DP-1:** A full dispense decreases batch stock, writes movements, sets the prescription to `dispensed`, and adds lines to the visit's draft invoice.
- **DP-2:** Two concurrent dispenses that together exceed a batch's stock: one succeeds, one gets 409, and stock never goes negative.
- **DP-3:** Repeating a request with the same idempotency key returns the first result with no second deduction.
- **DP-4:** Dispensing more than the prescribed quantity is rejected, including when two partial dispenses run at the same time.
- **DP-5:** A return within `return_window_days` creates a `dispensing_returns` row.
  - It restocks the **original batch** only if every check passes (unopened, packaging intact, batch verified, storage conditions maintained, pharmacist verified) and the batch is active and unexpired. Otherwise it's recorded with no stock movement.
  - On the billing side, it reduces the draft invoice line, or creates a credit note with `origin = dispense_return` if the invoice is already issued.
- **DP-6:** Each batch's `qty_on_hand` equals the sum of its movements, checked by a reconciliation query after every stock test.
- **DP-7:** Running a dispense, a stock adjustment and a return on the same batch at the same time leaves a consistent final quantity and movement history, with no negative stock and no lost updates.
- **DP-8:** Only users with `prescription:dispense` can dispense. Doctors, nurses and every other role get 403.
- **DP-9:** Two concurrent returns against one dispensing line can never return more than was dispensed in total.
- **DP-10:** Only a medicine product can be dispensed against a prescription. A general-store item returns 422, and the database rejects it via the FK to `medicine_products`.
- **DP-11:** These all get 422, and the service and the database CHECKs both enforce them:
  - a return after `return_window_days` (`RETURN_WINDOW_EXPIRED`)
  - a restock where any checklist item fails
  - a restock into an expired, recalled or quarantined batch
  - restocking a cold-chain item with no approved policy reference

### Stock control (ST)
Stock adjustments are the movement kinds `adjustment_in`, `adjustment_out`, `damage` and `expiry_writeoff`. ST-7 and ST-9 to ST-12 cover transfers. If transfers are deferred from the MVP, these criteria stay binding for the phase that implements them. The permissions and location kinds are listed in [`permissions.md`](permissions.md) note 3.
- **ST-1:** A user with `stock:adjust_pharmacy` (PHA) can adjust a batch in a pharmacy location. The same user adjusting a batch in a store location gets 403, and an `access.denied` audit row is written.
- **ST-2:** A user with `stock:adjust_store` (INV) can adjust a batch in a store location. The same user adjusting a batch in a pharmacy location gets 403, and an `access.denied` audit row is written.
- **ST-3:** Every adjustment stores the actor, timestamp, reason, location, batch and signed quantity change on its stock movement. A request without a reason returns 422, and the database rejects an adjustment movement with no reason or with a location that doesn't match its batch.
- **ST-4:** An adjustment and its `stock.adjusted` audit row are written in the same transaction. The audit row names the actor, batch, location and reason. A rejected or rolled-back adjustment leaves no movement and no audit row for the change.
- **ST-5:** An adjustment that would take a batch below zero returns 409, and the batch is unchanged.
- **ST-6:** A supplier goods receipt needs `goods_receipt:create` (INV); PHA and every other role get 403. A goods receipt into a pharmacy location is rejected with 422 by the service and by the database (composite FK on the location kind).
- **ST-7:** Creating, dispatching or cancelling a transfer needs the permission for its **source**: `stock_transfer:dispatch_pharmacy` (PHA) or `stock_transfer:dispatch_store` (INV). Accepting it needs the permission for its **destination**: `stock_transfer:receive_pharmacy` (PHA) or `stock_transfer:receive_store` (INV). Any other combination gets 403. A dispatched transfer adds no stock at the destination until it is explicitly accepted. *(Tested on Day 18 only if transfers are built; see the roadmap.)*
- **ST-8:** Dispensing, adjustments, supplier goods receipts and transfer receipts are separate endpoints. Each needs its own permission and writes its own movement kind (`dispense`, the adjustment kinds, `receipt`, `transfer_in`) and audit action (`dispensing.created`, `stock.adjusted`, `goods_receipt.created`, `stock_transfer.received`). The adjustment endpoint rejects any other movement kind with 422.
- **ST-9:** The dispatcher of a transfer gets 403 when accepting, rejecting or recording the return of that transfer. The rejecter gets 403 when recording its return. Each refusal writes an `access.denied` audit row. The database also rejects a transfer whose receiver, rejecter or returner is the dispatcher, or whose returner is the rejecter.
- **ST-10:** A transfer without a reason returns 422. Every transfer records its reason, source and destination, the dispatcher, receiver, rejecter and returner with their times, and each line's batches and quantity.
- **ST-11:** Rejection needs a reason and moves no stock; the goods stay in transit. A rejected, returned or cancelled transfer keeps its full history (source, destination, batches, quantities, actors, times, rejection reason and status) and can't be deleted. Accepting the return writes one `transfer_return` movement per line, putting exactly the line quantity back into its **original** source batch. A dispatched transfer can't be cancelled (409), and cancelling a draft moves no stock.
- **ST-12:** Two concurrent acceptances, or an acceptance racing a rejection, give exactly one success and one 409. A second return gets 409. After every transfer test, the reconciliation query shows that each line's `transfer_out` quantity equals its `transfer_in` or `transfer_return` quantity (never both), and that source, in-transit and destination totals are unchanged. DP-6 still holds.

### Expiry (EX)
All expiry checks are enforced by the API, and the tests call the API directly with no UI.
- **EX-1:** A batch with `expiry_date < today` is rejected.
- **EX-2:** When `duration_days` is known, a batch with `expiry_date < today + duration_days − 1` (it would expire before the course ends) is rejected. The check always uses the **full prescribed duration counted from the dispensing date**, even when only part of the quantity is dispensed.
- **EX-3:** A batch with `expiry_date <= today + near_expiry_days` returns 422 `NEAR_EXPIRY_ACK_REQUIRED` unless the request acknowledges it. The acknowledgement is stored on the line.
- **EX-4:** Recalled or quarantined batches are rejected.
- **EX-5:** A batch that expired between being listed and being dispensed is still rejected at commit time.

### Substitution (SB)
- **SB-1:** Dispensing a different product when `substitution_allowed = false` returns 422.
- **SB-2:** When substitution is allowed but the products differ in ingredient set, any strength, dosage form or route, the request returns 422. The server computes equivalence.
- **SB-3:** An equivalent product without the pharmacist's `substitution_verified` flag returns 422.
- **SB-4:** A successful substitution stores the prescribed product, dispensed product, verifier and note.
- **SB-5:** The UI shows equivalent products only when the pharmacist searches for them. They are neither ranked nor auto-selected.

### Discounts (DS)
- **DS-1:** A cumulative discount up to `discount_limit_bp` (default 10%) of the gross total is applied immediately. The record holds the base amount, percentage, amount, reason, requester and time.
- **DS-2:** A cumulative discount above the threshold becomes `pending_approval`. The invoice can't be issued until the discount is decided.
- **DS-3:** Approval requires `discount:approve` and a user other than the requester. Self-approval returns 403. The approver, decision, time and any rejection reason are recorded.
- **DS-4:** Several small discounts that add up to more than the threshold trigger approval.
- **DS-5:** Discounts can be added only to draft invoices.
- **DS-6:** Changing `discount_limit_bp` affects new discounts only. Discounts already decided are not re-evaluated.

### Billing (BL)
- **BL-1:** Invoice totals equal their lines minus discounts, plus tax. This is checked at commit time.
- **BL-2:** A partial payment leaves the correct balance.
- **BL-3:** A duplicate payment submission is recorded once.
- **BL-4:** A payment larger than the balance is rejected.
- **BL-5:** Voiding needs a reason and a net payment of zero.
- **BL-6:** A credit note reduces the amount owed, and any overpayment shows as `refund_due`.
- **BL-7:** A refund needs approval from someone other than the requester and can't exceed the payment's unrefunded amount.
- **BL-8:** The daily collection total equals that day's payments minus refunds.
- **BL-9:** The API has no delete route for financial data, and the application's database role can't delete it either.
- **BL-10:** A consultation, dispensing line or lab order can appear on at most one active invoice line. This is enforced by typed FKs with partial unique indexes.
- **BL-11:** A credit note created by a return, a cancellation after check-in or a lab cancellation is allowed under that workflow's permission and records its `origin`. A manual credit note needs `credit_note:create`.
- **BL-12:** Discarding a draft invoice needs `invoice:discard_draft` and a reason. Voiding an issued invoice needs `invoice:void`.

### Follow-ups (FU)
- **FU-1:** A recommendation shows as pending, due or overdue on the reception dashboard.
- **FU-2:** Booking it links the appointment and sets the follow-up to `booked`.
- **FU-3:** Cancelling that appointment returns the follow-up to `pending`.
- **FU-4:** A no-show on that appointment sets the follow-up to `missed`.

### Laboratory (LB)
- **LB-1:** The order → collect → result → verify flow works. Only LAB can record sample collection, and a nurse gets 403.
- **LB-2:** The person who entered a result can't verify it.
- **LB-3:** Abnormal values are flagged against the reference range.
- **LB-4:** A report can be printed only after verification.
- **LB-5:** An amendment keeps the earlier version.

### Dashboards (DB)
- **DB-1:** Every dashboard metric comes from a query. A test seeds known data and asserts the exact values shown.

### Security (SE)
- **SE-1:** Every endpoint is tested against every role (a table-driven test).
- **SE-2:** Requests without a session get 401.
- **SE-3:** Requests that change data without a CSRF token get 403.
- **SE-4:** Five failed logins lock the account for 15 minutes.
- **SE-5:** No patient data appears in logs.
- **SE-6:** A deactivated user's existing session is rejected on its next request.

### Administration (AD)
- **AD-1:** SA can list users, create and deactivate accounts, grant and revoke users' roles (`user_role:assign`), and change the permissions of roles SA doesn't hold (`role:manage`).
- **AD-2:** ADM can create, deactivate and reset passwords for non-SA staff accounts (`user:manage`). ADM gets 403 when managing an SA account, changing their own account status, granting or revoking any role, or changing a role's permissions.
- **AD-3:** Every user, including SA, gets 403 when changing their own role assignments or the permissions of a role they hold. Disabling, or removing the SA role from, the last active SA returns 409.
- **AD-4:** Account, role and role-permission changes need a reason (422 without one). Each writes an audit row in the same transaction naming the actor, target user or role, action, reason, and the role or permission code.
- **AD-5:** SA and ADM can read the audit log; every other role gets 403. No API route updates or deletes audit rows, no permission allows it, and the application's database role can't do either. A direct UPDATE or DELETE on `audit_logs` is blocked by the trigger.
- **AD-6:** SA's audit viewer shows audit metadata and patient identifiers (patient ID and MRN), never patient names, contact details, other demographics or clinical note contents. Every audit-log search writes exactly one `audit_log.searched` row, and neither writing nor reading that row creates further audit rows.
- **AD-7:** SA can change system and security settings, and ADM can change only the allowlisted operational settings. A key outside the caller's permission returns 403, and an unknown key returns 422. Every change needs a reason and writes a `settings.changed` row with the key and its old and new values.
- **AD-8:** A new account with no roles can log in, change its own password and log out, and gets 403 on every other protected endpoint. After SA assigns a role, the new permissions apply on the user's next request.

## 6. The end-to-end acceptance scenario

| Step | What happens | Criteria tested |
|---|---|---|
| 1 | Receptionist registers or finds the patient | PR-1 to PR-3 |
| 2 | Receptionist checks the schedule and books | SC-1, BK-1, BK-2 |
| 3 | Patient is checked in and queued; the nurse records vitals | QU-1, QU-2, QU-4, CF-1, CF-2 |
| 4 | Doctor reviews history and records the consultation | AX-1, AX-8, CN-1, CN-2 |
| 5 | Doctor prescribes and recommends a follow-up | RX-4, FU-1 |
| 6 | Doctor checks medicine availability | RX-1 to RX-3 |
| 7 | Pharmacist verifies and dispenses | DP-1 to DP-4, DP-8, DP-10, EX-*, SB-* |
| 8 | Batch-level stock movements are recorded | DP-1, DP-6, DP-7, ST-1, ST-3 |
| 9 | Charges and payments are recorded | CF-4, CF-5, DS-*, BL-1 to BL-4, BL-10 |
| 10 | Receptionist books the follow-up | FU-2 |
| 11 | Dashboards reflect all of the above | DB-1 |
| 12 | Audit and permissions hold throughout | AX-*, SE-*, AD-* |

The failure cases that must be tested are:
- concurrent booking (BK-2)
- insufficient stock (DP-2)
- concurrent stock updates (DP-7)
- expired medicine (EX-1, EX-5)
- duplicate payments (BL-3)
- invalid input (PR-3)
- unauthorized record access (AX-2, AX-7, AX-9)

## 7. Non-functional requirements

- Around 50 concurrent staff users.
- Pages respond in under 1 second on the demo data.
- Latest Chrome and Edge, desktop-first.
- English UI.
- Asia/Kolkata time zone.
- Indian rupees on screen, paise in storage.
