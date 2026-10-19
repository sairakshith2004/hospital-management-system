import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-xl border border-sky-100 bg-white p-6 shadow-sm shadow-sky-100/60 dark:border-slate-700 dark:bg-slate-900',
        className,
      )}
      {...props}
    />
  );
}
