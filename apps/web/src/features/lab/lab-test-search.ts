import type { LabTestView } from '@hospitalos/shared';

/** True when the test's name, code or sample type contains every word of the search. */
export function matchesLabTest(
  t: Pick<LabTestView, 'code' | 'name' | 'sampleType'>,
  search: string,
): boolean {
  const haystack = `${t.code} ${t.name} ${t.sampleType}`.toLowerCase();
  return search
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

/** "12–17", "below 200", "40 or more", plus any text range: "Men 13–17; women 12–15". */
export function formatReference(p: {
  refLow: string | null;
  refHigh: string | null;
  refText: string | null;
}): string {
  const low = p.refLow !== null ? Number(p.refLow) : null;
  const high = p.refHigh !== null ? Number(p.refHigh) : null;
  const numeric =
    low !== null && high !== null
      ? `${low}–${high}`
      : high !== null
        ? `up to ${high}`
        : low !== null
          ? `${low} or more`
          : '';
  return [numeric, p.refText ?? ''].filter(Boolean).join(' · ');
}
