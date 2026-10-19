import { useEffect, useState } from 'react';
import { cn } from './lib/utils';
import { checkApiHealth } from './lib/api';

type Status = 'checking' | 'online' | 'offline';

const LABELS: Record<Status, string> = {
  checking: 'Checking connection to the server',
  online: 'Connected to the server',
  offline: 'Not connected to the server',
};

const DOT: Record<Status, string> = {
  checking: 'bg-slate-400',
  online: 'bg-emerald-500',
  offline: 'bg-red-600',
};

/** How often the dot rechecks the server, in milliseconds. */
export const RECHECK_MS = 30_000;

/**
 * A small dot fixed to the top edge of the screen: green when the API answers, red when it
 * doesn't. It rechecks every 30 seconds and when the tab or network comes back. The status
 * is also given in words for screen readers and as a tooltip.
 */
export function ApiStatus() {
  const [status, setStatus] = useState<Status>('checking');

  useEffect(() => {
    let active = true;
    const check = () =>
      void checkApiHealth().then((result) => {
        if (active) setStatus(result);
      });
    check();
    const timer = setInterval(check, RECHECK_MS);
    const onVisible = () => document.visibilityState === 'visible' && check();
    window.addEventListener('online', check);
    window.addEventListener('offline', check);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('online', check);
      window.removeEventListener('offline', check);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      title={LABELS[status]}
      className="pointer-events-auto fixed top-1.5 right-1.5 z-50 flex size-4 items-center justify-center"
    >
      <span
        aria-hidden="true"
        className={cn(
          'size-2.5 rounded-full ring-2 ring-white dark:ring-slate-900',
          DOT[status],
          status === 'offline' && 'animate-pulse',
        )}
      />
      <span className="sr-only">{LABELS[status]}</span>
    </div>
  );
}
