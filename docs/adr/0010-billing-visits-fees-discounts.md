# ADR 0010: Billing by visit, consultation fees and discounts

- **Status:** Accepted
- **Date:** 2026-10-14

## Context
- **Q2:** The consultation fee is charged at check-in, before any encounter exists. Fees are configurable per doctor or per service. Patients may pay later.
- **Q4:** Discounts up to a configurable threshold (default 10%) need no approval. Larger discounts need approval from someone other than the requester, with a complete audit trail.
- **D7:** Dispensing adds charges to the open invoice.

## Decision
- **Invoices link to the visit (the appointment)**, not the encounter. A visit has at most one `draft` invoice (enforced by a partial unique index). Check-in, dispensing and lab orders add lines to it, or create it if it doesn't exist.
- **Fee resolution at check-in:**
  1. `doctor_fees` for the doctor, the visit type (new or follow-up) and today's date.
  2. Otherwise, the department's consultation price in `service_catalogue`.
  The price is copied into the invoice line, so later fee changes don't affect it.
- **Each charge appears on an invoice at most once.**
  - Invoice lines point at what they charge for through **typed foreign keys**: `consultation_appointment_id`, `dispensing_line_id` and `lab_order_id`.
  - A CHECK requires exactly the column that matches `source_type` to be set.
  - A partial unique index on each column, over active lines, prevents double-charging.
  - This replaces a polymorphic `source_id`, which the database couldn't check.
- **Payment never blocks care.** Check-in, consultation, lab orders and dispensing don't wait for payment. Partial payments and outstanding balances are supported.
- **Discounts** are rows in `invoice_discounts`, each recording:
  - the base amount, percentage and amount
  - `threshold_bp_at_request` (the threshold in force when it was requested)
  - the reason and requester
  - the status, approver, decision time and decision note
- **The threshold** is `hospital_settings.discount_limit_bp`. It is measured **cumulatively per invoice**, so splitting one discount into several small ones doesn't get around it.
  - A discount above the threshold becomes `pending_approval`.
  - The invoice can't be issued until the discount is decided.
  - The approver needs `discount:approve` and can't be the requester. A CHECK constraint and the service both enforce this.
- **Corrections:**
  - Credit notes for returns, cancellations and partial corrections. Each records its `origin` (manual, dispense_return, appointment_cancel or lab_cancel).
    - Manual credit notes need `credit_note:create`.
    - Workflow credit notes are authorized by the triggering permission: `dispense:return`, `appointment:cancel` or `lab_order:cancel`.
  - Draft invoices are discarded with `invoice:discard_draft` and a reason.
  - Void and reissue (`invoice:void`) when the whole issued invoice is wrong and nothing has been paid.
  - Refunds are approved by someone other than the requester, and are limited by `payments.refunded_paise`.
- **Totals integrity:** CHECK constraints plus deferred constraint triggers check the invoice's totals against its lines, discounts, payments, refunds and credit notes at commit time.

## Alternatives considered
- **Invoices linked to the encounter.** There is no encounter yet at check-in.
- **A per-request discount limit.** Can be circumvented by splitting the discount.
- **Requiring payment before consultation.** Rejected in Q2.

## Consequences
- The design supports both pay-now and pay-later front desks.
- There are more billing tables (discounts and credit notes), but every correction is traceable.
