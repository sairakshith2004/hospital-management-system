import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto rounded-xl border border-sky-100 bg-white shadow-sm shadow-slate-900/5 dark:border-slate-700 dark:bg-slate-900">
      <table className={cn('w-full text-left text-sm', className)} {...props} />
    </div>
  );
}

export function Th({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn(
        'bg-sky-50 px-3 py-2.5 text-xs font-semibold tracking-wide text-brand-900 uppercase dark:bg-slate-800 dark:text-slate-200',
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn('border-t border-slate-200 px-3 py-2 dark:border-slate-700', className)}
      {...props}
    />
  );
}
