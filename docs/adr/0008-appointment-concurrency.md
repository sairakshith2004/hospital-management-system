# ADR 0008: Appointment concurrency control

- **Status:** Accepted
- **Date:** 2026-10-14

## Context
Two receptionists can try to book the same slot at the same moment. If the code checks availability first and then inserts, both checks can pass before either insert happens, and the slot gets double-booked.

## Decision
- **Overlap:** an exclusion constraint makes the database reject any two active appointments for the same doctor whose time ranges overlap:
  `EXCLUDE USING gist (doctor_id WITH =, tstzrange(slot_start, slot_end) WITH &&) WHERE (active and slot_start is not null)`
- **Capacity and tokens:** `pg_advisory_xact_lock` on (doctor, date) makes `max_bookings` counting and token assignment happen one at a time per doctor per day.
- **Duplicate bookings:** a partial unique index allows only one active appointment per patient, doctor and day.
- A constraint violation is translated into HTTP 409 with a clear message.

## Alternatives considered
- **Checking availability in the application, then inserting.** This has the race condition described above.
- **SERIALIZABLE isolation for every booking.** Correct, but it needs retry loops and is harder to explain.
- **A unique index on `slot_start`.** It can't catch slots that partly overlap, or slots of different lengths.

## Consequences
- The guarantee holds even if the application has a bug.
- Requires the `btree_gist` extension and a hand-written SQL migration.
- Proven by test BK-2: of 10 parallel bookings for one slot, exactly 1 succeeds.
