import { useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import { ApiStatus } from '../ApiStatus';
import { Alert } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { useAuth } from '../features/auth/auth-context';
import { ApiError } from '../lib/api';
import { cn } from '../lib/utils';
import { visibleNavItems } from './navigation';

export function AppShell() {
  const { user, can, logout } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSignOut() {
    setSigningOut(true);
    setError(null);
    try {
      // RequireAuth sends the signed-out user to /login?signedOut=1.
      await logout();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-out failed. Please try again.');
      setSigningOut(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
          <span className="text-lg font-semibold">HospitalOS</span>
          <div className="flex items-center gap-3">
            <span className="hidden text-right text-sm sm:block">
              <span className="block font-medium">{user?.fullName}</span>
              <span className="block text-xs text-slate-500 dark:text-slate-400">
                {user?.roles.length ? user.roles.join(', ') : 'No role assigned'}
              </span>
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void onSignOut()}
              disabled={signingOut}
            >
              {signingOut ? 'Signing out…' : 'Sign out'}
            </Button>
          </div>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-6xl flex-1 gap-6 px-4 py-6">
        <nav aria-label="Main" className="w-48 shrink-0">
          <ul className="space-y-1">
            {visibleNavItems(can).map((item) => (
              <li key={item.path}>
                <NavLink
                  to={item.path}
                  end
                  className={({ isActive }) =>
                    cn(
                      'block rounded-md px-3 py-2 text-sm',
                      isActive
                        ? 'bg-teal-50 font-medium text-teal-800 dark:bg-teal-950 dark:text-teal-200'
                        : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                    )
                  }
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <main className="min-w-0 flex-1 space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
          <Outlet />
        </main>
      </div>
      <footer className="border-t border-slate-200 py-3 dark:border-slate-800">
        <p className="mb-1 text-center text-xs text-slate-500 dark:text-slate-400">
          Synthetic data only. Not for real patient information.
        </p>
        <ApiStatus compact />
      </footer>
    </div>
  );
}
