import { cn } from '../../lib/utils';

export function Spinner({ label = 'Loading…', className }: { label?: string; className?: string }) {
  return (
    <span role="status" className={cn('inline-flex items-center gap-2 text-sm', className)}>
      <span
        aria-hidden="true"
        className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
      />
      <span>{label}</span>
    </span>
  );
}

/** Centred spinner for whole-page waits, such as the startup session check. */
export function PageSpinner({ label }: { label?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center text-slate-600 dark:text-slate-300">
      <Spinner label={label} />
    </div>
  );
}
