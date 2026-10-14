# ADR 0012: Outpatient-only MVP scope

- **Status:** Accepted
- **Date:** 2026-10-14

## Context
A full multispecialty hospital has inpatient care, but the 30-day, roughly 210-hour budget can't cover it alongside the integrated outpatient workflow (Q1).

## Decision
- **In scope:** outpatient care, meaning registration → appointment or walk-in → consultation → prescription and lab orders → dispensing → billing → follow-up.
- **Deferred:** inpatient admissions, beds, wards, transfers and discharge, plus emergency triage.
- **Laboratory** is Tier 2.
- **Locations (Q7):** one outpatient pharmacy (`OPD-PHARM`) and one general store (`GEN-STORE`). The `locations` table supports more.
- **Stock transfers** are modelled. If time is short, only a single-step transfer is built, or the feature is deferred.

## Alternatives considered
- **Include inpatient care.** It would need roughly 5 more days and a different billing model (running bills and bed charges). Rejected for the MVP.

## Consequences
- The 12-step acceptance scenario can be completed and tested properly.
- Inpatient care becomes a later phase. Patients, encounters, billing and stock are designed so they can be reused for it.
