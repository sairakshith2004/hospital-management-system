import { ROLE_NAMES, type RoleCode } from '@hospitalos/shared';
import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { ApiStatus } from '../ApiStatus';
import { Alert } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { initials, LogoMark } from '../components/ui/logo';
import { useAuth } from '../features/auth/auth-context';
import { ApiError } from '../lib/api';
import { cn } from '../lib/utils';
import { navSections } from './navigation';

const roleLabel = (code: string) => ROLE_NAMES[code as RoleCode] ?? code;

export function AppShell() {
  const { user, can, logout } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const [lastPath, setLastPath] = useState(location.pathname);
  if (lastPath !== location.pathname) {
    // Close the mobile menu after navigating.
    setLastPath(location.pathname);
    setMenuOpen(false);
  }

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

  const sections = navSections(can);

  return (
    <div className="flex min-h-screen flex-col bg-slate-100/60 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div
        aria-hidden="true"
        className="h-1 bg-gradient-to-r from-brand-700 via-brand-500 to-teal-400"
      />
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        <div className="flex h-16 items-center justify-between gap-4 px-4 md:px-6">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              className="md:hidden"
              aria-expanded={menuOpen}
              aria-controls="main-nav"
              onClick={() => setMenuOpen((o) => !o)}
            >
              {menuOpen ? 'Close menu' : 'Menu'}
            </Button>
            <LogoMark />
            <span className="leading-tight">
              <span className="block text-lg font-bold tracking-tight text-brand-900 dark:text-white">
                HospitalOS
              </span>
              <span className="hidden text-xs text-slate-500 sm:block dark:text-slate-400">
                Multispecialty hospital · Staff portal
              </span>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-right text-sm sm:block">
              <span className="block font-medium text-slate-900 dark:text-slate-100">
                {user?.fullName}
              </span>
              <span className="block text-xs text-slate-500 dark:text-slate-400">
                {user?.roles.length ? user.roles.map(roleLabel).join(', ') : 'No role assigned'}
              </span>
            </span>
            <span
              aria-hidden="true"
              className="hidden size-9 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-800 ring-2 ring-white sm:inline-flex dark:bg-brand-900 dark:text-brand-100 dark:ring-slate-900"
            >
              {initials(user?.fullName)}
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
      <div className="flex flex-1">
        <nav
          id="main-nav"
          aria-label="Main"
          className={cn(
            'w-64 shrink-0 bg-brand-950 px-3 py-5 text-white dark:border-r dark:border-slate-800 dark:bg-slate-900',
            'fixed top-[4.25rem] bottom-0 left-0 z-20 overflow-y-auto md:sticky md:block md:h-[calc(100vh-4.25rem)]',
            menuOpen ? 'block' : 'hidden',
          )}
        >
          {sections.map(({ section, items }) => (
            <div key={section} className="mb-5">
              <p className="mb-1.5 px-3 text-[0.7rem] font-semibold tracking-wider text-brand-300/80 uppercase">
                {section}
              </p>
              <ul className="space-y-0.5">
                {items.map((item) => (
                  <li key={item.path}>
                    <NavLink
                      to={item.path}
                      end
                      className={({ isActive }) =>
                        cn(
                          'block rounded-md border-l-[3px] px-3 py-2 text-sm transition-colors',
                          isActive
                            ? 'border-teal-400 bg-white/10 font-medium text-white'
                            : 'border-transparent text-brand-100/80 hover:bg-white/5 hover:text-white',
                        )
                      }
                    >
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <main className="mx-auto w-full max-w-7xl flex-1 space-y-4 px-4 py-6 md:px-8">
            {error && <Alert tone="error">{error}</Alert>}
            <Outlet />
          </main>
          <footer className="border-t border-slate-200 bg-white py-3 dark:border-slate-800 dark:bg-slate-900">
            <p className="mb-1 text-center text-xs text-slate-500 dark:text-slate-400">
              Synthetic data only. Not for real patient information.
            </p>
            <ApiStatus compact />
          </footer>
        </div>
      </div>
    </div>
  );
}
