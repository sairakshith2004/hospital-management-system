import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

const TONES = {
  neutral: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  info: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  success: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  warning: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  danger: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
  accent:
    'bg-brand-100 text-brand-800 ring-1 ring-brand-200 ring-inset dark:bg-brand-950 dark:text-brand-200 dark:ring-brand-800',
} as const;

export type BadgeTone = keyof typeof TONES;

export function Badge({
  tone = 'neutral',
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}
