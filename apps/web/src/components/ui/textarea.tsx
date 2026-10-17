import type { TextareaHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'min-h-20 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-teal-600',
        'disabled:opacity-60 aria-[invalid=true]:border-red-600',
        'dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100',
        className,
      )}
      {...props}
    />
  );
}
