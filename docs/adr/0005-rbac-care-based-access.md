# ADR 0005: RBAC with care-based patient access and emergency access

- **Status:** Accepted
- **Date:** 2026-10-14
- **Amended:** 2026-10-15 (scope clarifications C2, C3, C4)

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
6. **System administration is separate from operations (C2, C3, C4).**
   - SA manages users, users' roles and role permissions (`user:manage`, `user_role:assign`, `role:manage`), system and security settings, and reads the audit log. SA holds no operational permissions such as dispensing, billing, stock, scheduling or operational settings.
   - ADM manages staff accounts (not SA accounts), departments and allowlisted operational settings, but can't assign roles or change role permissions. A new account has no permissions until SA assigns a role.
   - No user, SA included, can change their own role assignments or the permissions of a role they hold. The last active SA can't be disabled or lose the role.
   - Every account, role, role-permission and settings change needs a reason and is audited.
   - Authorized audit viewers see patient identifiers (including MRN where needed) and audit metadata, never clinical note contents. Each search is recorded once, without recursive audit events. Nobody, SA included, can alter or delete audit rows.
7. **Granular permissions, not more roles.** The project has exactly 11 roles. Equipment and maintenance is a permission group under the Inventory / Procurement Manager. Finer splits, such as per-location stock permissions and per-category settings permissions, are new permission codes.

## Alternatives considered
- **Role-only checks.** Too broad for medical records.
- **Lifetime access after any encounter.** Rejected by the project owner.
- **One general-purpose settings permission.** Rejected (C3): it would let ADM change access-control settings and SA change operational policy.
- **SA with full operational permissions.** Rejected: it would combine account control with operational actions such as dispensing and refunds, so one account could grant itself a capability and use it.
- **Department-wide nurse access.** Rejected for least privilege. A nurse sees only patients in the sessions they're assigned to.
- **A hard cap on active emergency grants.** Rejected, because it could block necessary emergency care.
- **Emergency access that allows writing.** Rejected for the MVP. Treatment requires registering a visit, which creates a routine care relationship and a proper encounter record.

## Consequences
- Every chart request costs one extra access query.
- Every clinical read writes an audit row, and the read fails if the audit row can't be written.
- Extending emergency access to nurses later is a permission and configuration change.
