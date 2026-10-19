/**
 * Gapless, per-year document numbers (invoices, receipts), e.g. INV-2026-000001. The
 * counter row is locked for the rest of the transaction, so numbers are never skipped or
 * reused: a rolled-back transaction gives its number back. Years are Indian financial
 * years (April–March) in the hospital time zone.
 */
import { hospitalToday } from '@hospitalos/shared';
import type { Queryable } from '../db/client.js';

export function fiscalYear(day: string = hospitalToday()): number {
  const [y, m] = day.split('-').map(Number) as [number, number];
  return m >= 4 ? y : y - 1;
}

export async function nextDocumentNo(
  db: Queryable,
  docType: 'INV' | 'RCT',
  day: string = hospitalToday(),
): Promise<string> {
  const year = fiscalYear(day);
  const { rows } = await db.query<{ value: number }>(
    `INSERT INTO document_counters (doc_type, fiscal_year, next_value) VALUES ($1, $2, 2)
     ON CONFLICT (doc_type, fiscal_year)
       DO UPDATE SET next_value = document_counters.next_value + 1
     RETURNING next_value - 1 AS value`,
    [docType, year],
  );
  return `${docType}-${year}-${String(rows[0]!.value).padStart(6, '0')}`;
}
