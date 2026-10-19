import { describe, expect, it } from 'vitest';
import { formatReference, matchesLabTest } from './lab-test-search';

const tft = { code: 'TFT', name: 'Thyroid profile (T3, T4, TSH)', sampleType: 'Blood (serum)' };

describe('matchesLabTest', () => {
  it('matches every word against code, name and sample, ignoring case', () => {
    expect(matchesLabTest(tft, '')).toBe(true);
    expect(matchesLabTest(tft, 'thyroid')).toBe(true);
    expect(matchesLabTest(tft, 'tft serum')).toBe(true);
    expect(matchesLabTest(tft, 'thyroid urine')).toBe(false);
  });
});

describe('formatReference', () => {
  const ref = (refLow: string | null, refHigh: string | null, refText: string | null = null) =>
    formatReference({ refLow, refHigh, refText });
  it('shows numeric ranges, one-sided limits and text ranges', () => {
    expect(ref('12.0000', '17.0000')).toBe('12–17');
    expect(ref(null, '200.0000')).toBe('up to 200');
    expect(ref('40.0000', null)).toBe('40 or more');
    expect(ref(null, null, 'Negative')).toBe('Negative');
    expect(ref(null, '5.0000', 'Below 5 when not pregnant')).toBe(
      'up to 5 · Below 5 when not pregnant',
    );
    expect(ref(null, null)).toBe('');
  });
});
