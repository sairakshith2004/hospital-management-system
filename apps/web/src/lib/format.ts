import { hospitalToday } from '@hospitalos/shared';

/** Paise to rupees, e.g. 50000 → "₹500.00". */
export function formatRupees(paise: number): string {
  return (paise / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' });
}

/** Whole years between a YYYY-MM-DD date of birth and today in the hospital time zone. */
export function ageInYears(dob: string, today: string = hospitalToday()): number {
  const [by, bm, bd] = dob.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

const SEX_LABELS: Record<string, string> = {
  female: 'Female',
  male: 'Male',
  other: 'Other',
  unknown: 'Unknown',
};

export function sexLabel(sex: string): string {
  return SEX_LABELS[sex] ?? sex;
}
