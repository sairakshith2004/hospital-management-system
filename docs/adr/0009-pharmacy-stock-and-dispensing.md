# ADR 0009: Pharmacy stock ledger and server-enforced dispensing

- **Status:** Accepted
- **Date:** 2026-10-14

## Context
Stock must never go negative, even when several people dispense at once. Expired medicine must never be dispensed. Substitution must be explicit and verified (Q5 and Q6). Every change to stock must leave a history.

## Decision
- **Ledger plus cache.**
  - `stock_movements` is an append-only ledger.
  - `stock_batches.qty_on_hand` is a cached running total, updated in the same transaction as each movement and protected by `CHECK (qty_on_hand >= 0)`.
  - A reconciliation query, run in the tests, proves the cache equals the sum of the movements.
- **Atomic dispensing.** One transaction:
  - locks the prescription, its items and the batches (batches in ascending id order)
  - re-checks everything on the server
  - writes movements, dispensing lines and invoice lines
  - is idempotent, using an `Idempotency-Key`
- **Expiry rules (Q5), enforced by the server.** "Today" is the current date in the hospital's time zone.
  - Reject if `expiry_date < today`.
  - Reject if `expiry_date < today + duration_days − 1`, i.e. the batch would expire before the course ends. This always uses the full prescribed duration counted from the dispensing date, even for a partial dispense.
  - Require an explicit, stored acknowledgement if `expiry_date ≤ today + near_expiry_days` (default 30).
  - Reject recalled or quarantined batches.
- **Substitution rules (Q6), enforced by the server.**
  - The prescriber must have set `substitution_allowed`.
  - The server recomputes equivalence from the ingredient set with exact strengths, the dosage form and the route.
  - The pharmacist must set `substitution_verified`, and needs the `dispense:substitute` permission.
  - Both the prescribed and dispensed products are recorded.
  - The system never ranks or auto-selects products.
- **Authorization.** Only `prescription:dispense` holders can dispense. Doctors can only search stock, never change it. Only medicine products can be dispensed: `dispensing_lines.dispensed_product_id` has an FK to `medicine_products`.
- **Traceability.** Every movement is referenced by a real FK from its source row (dispensing line, return, goods-receipt line, transfer line). `stock_movements.ref_type` and `ref_id` are informational only.
- **Returns.** Each return is a row in `dispensing_returns`.
  - Returns are accepted only within the configurable `return_window_days` (default 7).
  - A return restocks the original batch only when every documented check passes (unopened, packaging intact, batch verified, storage conditions maintained, pharmacist verified) and the batch is active and unexpired.
  - Expired, recalled, quarantined, opened, improperly stored or otherwise ineligible medicine is never restocked.
  - Cold-chain items aren't restocked unless an approved, documented policy (`cold_chain_restock_policy_ref`) confirms the cold chain stayed intact.
  - Database CHECKs back up these service rules.
  - On billing, it either reduces the draft invoice line or links to a credit-note line, exactly one of the two.
  - Concurrent returns are serialized by locking the dispensing line.
- **Locations (Q7).** One outpatient pharmacy and one general store are seeded. Stock transfers are modelled with paired `transfer_out` and `transfer_in` movements, and the full workflow is deferred if time is short.

## Alternatives considered
- **Ledger only, with the balance computed by summing.** Slow, and there's no single row to lock.
- **Cached quantity only.** No history and no way to reconcile.
- **Expiry and substitution checks in the UI.** Can be bypassed by calling the API directly. Rejected.

## Consequences
- Dispensing is the most complex service. It has tests for concurrency (DP-2, DP-4, DP-7, DP-9), idempotency (DP-3), expiry (EX-1 to EX-5), substitution (SB-1 to SB-5) and medicine-only dispensing (DP-10).
- The allergy and equivalence checks are factual data comparisons, not validated clinical decision support.
