import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ApiStatus } from '../../ApiStatus';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { LogoMark } from '../../components/ui/logo';
import { ApiError } from '../../lib/api';
import { cn } from '../../lib/utils';
import { useAuth } from './auth-context';
import { accountFitsPortal, OTHER_STAFF, PORTALS, type Portal } from './portals';
import { safeNext } from './redirect';

/** The Super Admin runs the whole hospital (docs/permissions.md note 13): every card opens. */
const opens = (p: Portal, roles: readonly string[]) =>
  roles.includes('SA') || accountFitsPortal(p, roles);

/**
 * The job portal cards, shown right after signing in. Cards for the account's own roles open
 * the app; the others are shown greyed out. The card never grants anything: what anyone can
 * see and do inside is decided by the server from the account's roles.
 */
export function PortalsPage() {
  const { user, logout, can } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const roles = user?.roles ?? [];
  // An account still waiting for a role uses the "Other staff" card.
  const cards = roles.length === 0 ? [...PORTALS, OTHER_STAFF] : PORTALS;

  async function onSignOut() {
    setSigningOut(true);
    setError(null);
    try {
      await logout();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-out failed. Please try again.');
      setSigningOut(false);
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-sky-50 via-white to-teal-50 px-4 py-10 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <LogoMark className="size-10" />
            <div>
              <p className="text-lg font-bold text-brand-900 dark:text-white">HospitalOS</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Multispecialty hospital</p>
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void onSignOut()}
            disabled={signingOut}
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </Button>
        </div>
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight text-brand-900 dark:text-white">
            Welcome, {user?.fullName}
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Choose your portal</p>
        </div>
        {error && <Alert tone="error">{error}</Alert>}
        {can('user:create') && (
          // HR (and the Super Admin) onboard new staff: straight to the new-member form.
          <button
            type="button"
            onClick={() => navigate('/admin/staff?add=1', { replace: true })}
            className="flex w-full items-center gap-4 rounded-xl border-2 border-brand-300 bg-brand-50 p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-brand-500 hover:shadow-md dark:border-brand-700 dark:bg-brand-950"
          >
            <span
              aria-hidden="true"
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-2xl font-bold text-white"
            >
              +
            </span>
            <span className="min-w-0">
              <span className="block font-semibold text-brand-900 dark:text-white">
                Add new staff member
              </span>
              <span className="block text-xs text-slate-600 dark:text-slate-300">
                Create the account for someone joining the hospital, with their department and
                designation. The Super Admin then gives them access.
              </span>
            </span>
          </button>
        )}
        <nav aria-label="Portals">
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((p) => {
              const open = opens(p, roles);
              return (
                <li key={p.key}>
                  <button
                    type="button"
                    disabled={!open}
                    onClick={() => navigate(next, { replace: true })}
                    className={cn(
                      'flex h-full w-full items-start gap-3 rounded-xl border bg-white p-4 text-left shadow-sm transition dark:bg-slate-900',
                      open
                        ? 'border-slate-200/80 shadow-slate-900/5 hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md dark:border-slate-700 dark:hover:border-brand-700'
                        : 'cursor-not-allowed border-dashed border-slate-200 opacity-50 dark:border-slate-700',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-sm font-bold',
                        p.tone,
                      )}
                    >
                      {p.mark}
                    </span>
                    <span className="min-w-0">
                      <span className="block font-semibold text-slate-900 dark:text-white">
                        {p.label}
                      </span>
                      <span className="block text-xs text-slate-500 dark:text-slate-400">
                        {open ? p.description : 'Not your role'}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
        <p className="text-center text-xs text-slate-500 dark:text-slate-400">
          Synthetic data only. Not for real patient information.
        </p>
      </div>
      <ApiStatus />
    </main>
  );
}
