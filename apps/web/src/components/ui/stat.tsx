import { Link } from 'react-router';
import { cn } from '../../lib/utils';

/** One real figure on a dashboard. `value` must come from the API, never a constant. */
export function Stat({
  label,
  value,
  to,
  tone = 'default',
}: {
  label: string;
  value: number | string;
  to?: string;
  tone?: 'default' | 'warning' | 'danger';
}) {
  const body = (
    <>
      <span className="block text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
        {label}
      </span>
      <span
        className={cn(
          'mt-1 block text-3xl font-bold text-brand-900 tabular-nums dark:text-white',
          tone === 'warning' && 'text-amber-700 dark:text-amber-400',
          tone === 'danger' && 'text-red-700 dark:text-red-400',
        )}
      >
        {value}
      </span>
    </>
  );
  const cls = cn(
    'block rounded-xl border border-l-4 p-4 shadow-sm shadow-slate-900/5',
    tone === 'default' && 'border-sky-100 border-l-sky-300 bg-gradient-to-br from-white to-sky-50',
    tone === 'warning' &&
      'border-amber-100 border-l-amber-300 bg-gradient-to-br from-white to-amber-50',
    tone === 'danger' &&
      'border-rose-100 border-l-rose-300 bg-gradient-to-br from-white to-rose-50',
  );
  return to ? (
    <Link
      to={to}
      className={cn(
        cls,
        'transition hover:-translate-y-0.5 hover:shadow-md hover:shadow-brand-900/10',
      )}
    >
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
