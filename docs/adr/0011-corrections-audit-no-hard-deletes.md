# ADR 0011: Corrections, audit trail and no hard deletes

- **Status:** Accepted
- **Date:** 2026-10-14
- **Amended:** 2026-10-15 (scope clarifications C2, C4)

## Context
Clinical and financial records must keep their history. Sensitive access and changes must be attributable to a person. Deleting rows to fix mistakes destroys evidence.

## Decision
- **Corrections are always new records:** void, reversal, credit note, amended lab result, or clinical-note addendum.
- **Foreign keys** use `ON DELETE RESTRICT`. Only pure join tables cascade.
- **Append-only tables:** `stock_movements` and `audit_logs`, protected by triggers.
- **The audit log is read-only for everyone.** SA and ADM hold `audit:read`, but there is no permission or API route to edit or delete audit rows, and the trigger blocks UPDATE and DELETE regardless of who asks. Searches of the audit log are themselves audited (`audit_log.searched`).
- **Clinical notes and diagnoses** can be edited only while their encounter is `in_progress`, and every edit is audited. Once the encounter is completed, a trigger blocks edits and corrections become addenda.
- **Vital signs** are never edited. A correction is a new reading, plus `entered_in_error = true` on the wrong one.
- **Database grants:** `hms_app` has no DELETE on clinical, financial or audit tables, and INSERT-only on `audit_logs`.
- **Audit rows** are written in the same transaction as the change they describe. A rolled-back change therefore leaves no misleading audit row, and a committed change always has one.
- **Clinical reads** write `patient.clinical.read` before returning data, and fail if that write fails.
- **Audit content:** the actor (`actor_type` is user, or system for the end-of-day job), action, entity, patient, emergency grant ID, request ID, IP and the names of the changed fields. Sensitive values, passwords and tokens are never stored.
- **Application logs** (pino) redact patient fields, credentials and session IDs.

## Alternatives considered
- **Soft-delete flags everywhere.** Every query would have to remember to filter them out, and the flags don't capture *why* something changed.
- **Clinical notes append-only from creation.** Rejected because typos made during a live consultation would clutter the record with addenda. Editing during the consultation is audited instead.
- **Asynchronous audit logging.** Audit rows could be lost, or written for changes that were rolled back.

## Consequences
- The history is complete and can be defended.
- There are more tables and some extra writes.
- Test BL-9 and the grant tests confirm that deletes are impossible.
