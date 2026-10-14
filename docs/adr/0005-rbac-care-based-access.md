# ADR 0005: RBAC with care-based patient access and emergency access

- **Status:** Accepted
- **Date:** 2026-10-14

## Context
Role checks alone would let any doctor read any patient's chart. The project owner rejected unrestricted lifetime access (Q3). However, emergency access must never be blocked by an arbitrary limit.

## Decision
1. **Permission codes** (for example `prescription:dispense`) are mapped to roles in `packages/shared/permissions.ts` and checked on every route.
2. **Record-level checks** run in services through the `access` module, on every request:
   - **Doctors:** a care relationship, meaning any of:
     - an active appointment from today up to `care_window_before_days` (default 7) ahead
     - an encounter that is in progress or was completed within `care_window_after_days` (default 90)
     - a pending or booked follow-up that targets the doctor
     - a lab order they placed that was verified inside the window
   - **Nurses:** an active, administrator-managed **session assignment** (`nurse_assignments`) for today's doctor session that the patient is checked in to. Enforced on the server, and every assignment change is audited.
   - **Pharmacists and lab staff:** limited to the clinical details of their own work items.
3. **The windows are configurable** in `hospital_settings`, with no code change.
4. **Emergency (break-glass) access:**
   - Doctors only.
   - Needs a reason category, a documented reason of at least 20 characters, and the password re-entered.
   - Read-only, for one patient, for a configurable duration (default 4 hours).
   - Fully audited, and reviewed afterwards by an administrator other than the user.
   - **No cap on the number of grants.** Going over the alert threshold (default 3 in 24 hours) sets `priority_review` on the grant but never denies access.
5. **Super Admin has no patient-data access.** IT administration is kept separate from clinical access.

## Alternatives considered
- **Role-only checks.** Too broad for medical records.
- **Lifetime access after any encounter.** Rejected by the project owner.
- **Department-wide nurse access.** Rejected for least privilege. A nurse sees only patients in the sessions they're assigned to.
- **A hard cap on active emergency grants.** Rejected, because it could block necessary emergency care.
- **Emergency access that allows writing.** Rejected for the MVP. Treatment requires registering a visit, which creates a routine care relationship and a proper encounter record.

## Consequences
- Every chart request costs one extra access query.
- Every clinical read writes an audit row, and the read fails if the audit row can't be written.
- Extending emergency access to nurses later is a permission and configuration change.
