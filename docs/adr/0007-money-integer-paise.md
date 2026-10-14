# ADR 0007: Money as integer paise

- **Status:** Accepted
- **Date:** 2026-10-14

## Context
Floating-point numbers cause rounding errors. Postgres `numeric` is exact, but Drizzle returns it as a string, which makes arithmetic in JavaScript error-prone.

## Decision
- Store every amount as `bigint` paise (₹1 = 100 paise).
- Store rates and percentages as integer basis points (1000 = 10%).
- Do all arithmetic in integers, in `lib/money.ts`. Format to rupees only for display.
- Allocate an invoice-level discount to lines in proportion to their amounts. Any leftover paise go to the largest line, so the lines always sum exactly to the invoice total.
- Calculate tax per line on the amount after discount.
- Tax rates are configurable, with a default of 0%. **No statutory GST compliance is claimed.**

## Alternatives considered
- **`numeric(12,2)` handled as strings or with decimal.js.** Workable, but it adds a dependency and makes conversion mistakes likely.
- **Floating point.** Ruled out because of rounding drift.

## Consequences
- Totals are exact and can be reconciled.
- The UI and API agree on integer amounts.
- Developers must remember the unit is paise. Names ending in `_paise` make that explicit.
