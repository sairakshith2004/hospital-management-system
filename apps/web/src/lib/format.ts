import { HOSPITAL_TIME_ZONE, hospitalToday } from '@hospitalos/shared';

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

const TIME = new Intl.DateTimeFormat('en-IN', {
  timeZone: HOSPITAL_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const DATE_TIME = new Intl.DateTimeFormat('en-IN', {
  timeZone: HOSPITAL_TIME_ZONE,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const DATE = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'UTC',
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

/** "09:15" in hospital time, from an ISO timestamp. */
export function formatTime(iso: string): string {
  return TIME.format(new Date(iso));
}

/** "07 Jan 2030, 09:15" in hospital time, from an ISO timestamp. */
export function formatDateTime(iso: string): string {
  return DATE_TIME.format(new Date(iso));
}

/** "Mon, 07 Jan 2030" from a YYYY-MM-DD date (no time-zone shift). */
export function formatDate(day: string): string {
  return DATE.format(new Date(`${day}T00:00:00Z`));
}

/** YYYY-MM-DD plus `days`, calendar arithmetic only. */
export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
