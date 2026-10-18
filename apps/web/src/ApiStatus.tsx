import { useCallback, useEffect, useState } from 'react';
import { cn } from './lib/utils';
import { checkApiHealth } from './lib/api';

type Status = 'checking' | 'online' | 'offline';

const LABELS: Record<Status, string> = {
  checking: 'Checking API…',
  online: 'API online',
  offline: 'API unreachable',
};

const DOT: Record<Status, string> = {
  checking: 'bg-slate-400',
  online: 'bg-emerald-600',
  offline: 'bg-red-600',
};

/** Live API health indicator. `compact` renders a single line for page footers. */
export function ApiStatus({ compact = false }: { compact?: boolean }) {
  const [status, setStatus] = useState<Status>('checking');

  useEffect(() => {
    let active = true;
    void checkApiHealth().then((result) => {
      if (active) setStatus(result);
    });
    return () => {
      active = false;
    };
  }, []);

  const recheck = useCallback(async () => {
    setStatus('checking');
    setStatus(await checkApiHealth());
  }, []);

  return (
    <section
      aria-label="System status"
      className={cn(
        'flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300',
        compact ? 'justify-center' : 'rounded-lg border border-slate-200 p-4 dark:border-slate-700',
      )}
    >
      <p role="status" aria-live="polite" className="flex items-center gap-2">
        <span aria-hidden="true" className={cn('size-2 rounded-full', DOT[status])} />
        {LABELS[status]}
      </p>
      <button
        type="button"
        onClick={() => void recheck()}
        disabled={status === 'checking'}
        className="rounded text-brand-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-brand-600 disabled:opacity-50 dark:text-brand-400"
      >
        Check again
      </button>
    </section>
  );
}
