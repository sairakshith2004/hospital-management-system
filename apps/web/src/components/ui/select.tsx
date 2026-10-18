import type { SelectHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

/** A styled native select: accessible and keyboard-friendly without extra code. */
export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-600',
        'disabled:opacity-60 aria-[invalid=true]:border-red-600',
        'dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100',
        className,
      )}
      {...props}
    />
  );
}
