import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { ApiStatus } from '../../ApiStatus';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { LogoMark } from '../../components/ui/logo';
import { cn } from '../../lib/utils';
import { PageSpinner } from '../../components/ui/spinner';
import { ApiError } from '../../lib/api';
import { useAuth } from './auth-context';
import { accountFitsPortal, findPortal, OTHER_STAFF, PORTALS, type Portal } from './portals';
import { safeNext } from './redirect';

function messageFor(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'Invalid username or password.';
    if (err.status === 429) return 'Too many attempts. Try again in a few minutes.';
    if (err.status === 0) return err.message;
    return err.requestId
      ? `Sign-in failed. Please try again. (Reference: ${err.requestId})`
      : 'Sign-in failed. Please try again.';
  }
  return 'Sign-in failed. Please try again.';
}

export function LoginPage() {
  const { status, login, logout } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const portal = findPortal(params.get('portal'));
  const next = safeNext(params.get('next'));
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  /** Portals that fit the account after a wrong-portal sign-in (the password was right). */
  const [suggested, setSuggested] = useState<Portal[] | null>(null);

  if (status === 'loading') return <PageSpinner label="Checking your session…" />;
  if (status === 'signedIn' && !submitting) return <Navigate to={next} replace />;

  function choosePortal(key: string | null) {
    const p = new URLSearchParams(params);
    if (key) p.set('portal', key);
    else p.delete('portal');
    setError(null);
    setSuggested(null);
    setParams(p, { replace: true });
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setSuggested(null);
    setSubmitting(true);
    try {
      const user = await login({ username: username.trim(), password });
      setPassword('');
      if (portal && !accountFitsPortal(portal, user.roles)) {
        // Display rule only: the server already limits this account to its own permissions.
        await logout().catch(() => undefined);
        const fits = PORTALS.filter((p) => accountFitsPortal(p, user.roles));
        setSuggested(fits);
        setError(
          fits.length > 0
            ? `“${user.username}” is not a ${portal.label} account. Sign in through the ${fits.map((p) => p.label).join(' or ')} portal instead.`
            : `This account isn't registered for the ${portal.label} portal. Choose the portal that matches your role.`,
        );
        setSubmitting(false);
        return;
      }
      navigate(next, { replace: true });
    } catch (err) {
      setPassword('');
      setError(messageFor(err));
      setSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-screen bg-white lg:grid-cols-[1.1fr_1fr] dark:bg-slate-950">
      <section
        aria-label="About HospitalOS"
        className="relative hidden overflow-hidden bg-gradient-to-br from-sky-100 via-white to-teal-100 p-12 text-brand-900 lg:flex lg:flex-col lg:justify-between"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 -right-24 size-96 rounded-full bg-violet-100/70"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-32 -left-16 size-80 rounded-full bg-pink-100/70"
        />
        <div className="relative flex items-center gap-3">
          <LogoMark className="size-11" />
          <p className="text-xl font-bold tracking-tight">HospitalOS</p>
        </div>
        <div className="relative max-w-md space-y-6">
          <p className="text-3xl leading-tight font-semibold">
            One hospital, one record — every department connected.
          </p>
          <ul className="space-y-3 text-sm text-slate-700">
            {[
              'Reception, appointments and doctor queues',
              'Consultations, prescriptions and lab results',
              'Pharmacy dispensing, inventory and billing',
            ].map((line) => (
              <li key={line} className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="inline-flex size-6 items-center justify-center rounded-full bg-teal-100 text-teal-700"
                >
                  ✓
                </span>
                {line}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-slate-500">
          Access is limited to authorised hospital staff. Activity is audited.
        </p>
      </section>
      <div className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center">
            <LogoMark className="mx-auto mb-3 size-12 lg:hidden" />
            <h1 className="text-2xl font-bold tracking-tight text-brand-900 dark:text-white">
              HospitalOS
            </h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              {portal ? 'Use your own hospital account' : 'Choose your portal to sign in'}
            </p>
          </div>
          {params.get('expired') === '1' && !error && (
            <Alert tone="info">Your session has ended. Please sign in again.</Alert>
          )}
          {params.get('signedOut') === '1' && !error && (
            <Alert tone="success">You have signed out.</Alert>
          )}
          {error && !portal && <Alert tone="error">{error}</Alert>}
          {portal ? (
            <Card className="shadow-lg shadow-brand-900/5">
              <div className="mb-5 flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className={cn(
                    'inline-flex size-10 items-center justify-center rounded-lg text-sm font-bold',
                    portal.tone,
                  )}
                >
                  {portal.mark}
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="font-semibold text-slate-900 dark:text-white">
                    {portal.label} sign in
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{portal.description}</p>
                </div>
                <button
                  type="button"
                  onClick={() => choosePortal(null)}
                  disabled={submitting}
                  className="text-sm text-brand-700 hover:underline disabled:opacity-50 dark:text-brand-300"
                >
                  Change
                </button>
              </div>
              <form className="space-y-4" onSubmit={(e) => void onSubmit(e)}>
                {error && (
                  <Alert tone="error">
                    {error}
                    {suggested && suggested.length > 0 && (
                      <span className="mt-2 flex flex-wrap gap-2">
                        {suggested.map((p) => (
                          <Button
                            key={p.key}
                            size="sm"
                            variant="secondary"
                            onClick={() => choosePortal(p.key)}
                          >
                            Switch to {p.label}
                          </Button>
                        ))}
                      </span>
                    )}
                  </Alert>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="username">Username</Label>
                  <Input
                    id="username"
                    name="username"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    required
                    maxLength={100}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    disabled={submitting}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    maxLength={256}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={submitting}
                    aria-invalid={error && !suggested ? true : undefined}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? 'Signing in…' : 'Sign in'}
                </Button>
              </form>
            </Card>
          ) : (
            <nav aria-label="Sign-in portals" className="space-y-3">
              <ul className="grid grid-cols-2 gap-3">
                {PORTALS.map((p) => (
                  <li key={p.key}>
                    <button
                      type="button"
                      onClick={() => choosePortal(p.key)}
                      className="flex h-full w-full items-start gap-3 rounded-xl border border-slate-200/80 bg-white p-3 text-left shadow-sm shadow-slate-900/5 transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md dark:border-slate-700 dark:bg-slate-900 dark:hover:border-brand-700"
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          'inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold',
                          p.tone,
                        )}
                      >
                        {p.mark}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-slate-900 dark:text-white">
                          {p.label}
                        </span>
                        <span className="block text-xs text-slate-500 dark:text-slate-400">
                          {p.description}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="text-center text-sm text-slate-600 dark:text-slate-400">
                No department yet?{' '}
                <button
                  type="button"
                  onClick={() => choosePortal(OTHER_STAFF.key)}
                  className="font-medium text-brand-700 hover:underline dark:text-brand-300"
                >
                  Other staff sign in
                </button>
              </p>
            </nav>
          )}
          <p className="text-center text-xs text-slate-500 dark:text-slate-400">
            Synthetic data only. Not for real patient information.
          </p>
          <ApiStatus compact />
        </div>
      </div>
    </main>
  );
}
