import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { PageSpinner } from '../../components/ui/spinner';
import { ApiError } from '../../lib/api';
import { useAuth } from './auth-context';
import { AuthLayout, PasswordToggle } from './AuthLayout';
import { safeNext } from './redirect';

function messageFor(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'Invalid username or password.';
    if (err.code === 'ACCOUNT_PENDING')
      return 'Your account is waiting for approval by a hospital administrator. Please try again later.';
    if (err.status === 429) return 'Too many attempts. Try again in a few minutes.';
    if (err.status === 0) return err.message;
    return err.requestId
      ? `Sign-in failed. Please try again. (Reference: ${err.requestId})`
      : 'Sign-in failed. Please try again.';
  }
  return 'Sign-in failed. Please try again.';
}

/**
 * The main sign-in page in front of the whole app: one username and password form for every
 * department. After signing in, the portal cards page (PortalsPage) opens. There is no
 * self sign-up: HR creates new staff members' accounts.
 */
export function LoginPage() {
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [username, setUsername] = useState(params.get('username') ?? '');
  const [password, setPassword] = useState('');
  const [shown, setShown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === 'loading') return <PageSpinner label="Checking your session…" />;
  /** After signing in, everyone chooses their portal card first, then goes on to `next`. */
  const portals = `/portals${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`;
  if (status === 'signedIn' && !submitting) return <Navigate to={portals} replace />;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await login({ username: username.trim(), password });
      setPassword('');
      navigate(portals, { replace: true });
    } catch (err) {
      setPassword('');
      setError(messageFor(err));
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to HospitalOS with your hospital account">
      {params.get('expired') === '1' && !error && (
        <Alert tone="info">Your session has ended. Please sign in again.</Alert>
      )}
      {params.get('reset') === '1' && !error && (
        <Alert tone="success">Your password has been changed. Sign in with the new one.</Alert>
      )}
      {params.get('signedOut') === '1' && !error && (
        <Alert tone="success">You have signed out.</Alert>
      )}
      {params.get('created') === '1' && !error && (
        <Alert tone="success">
          Account created. A hospital administrator will approve it and give you your role; then
          sign in here.
        </Alert>
      )}
      <Card className="shadow-lg shadow-brand-900/5">
        <form className="space-y-4" onSubmit={(e) => void onSubmit(e)}>
          {error && <Alert tone="error">{error}</Alert>}
          <div className="space-y-1.5">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              name="username"
              placeholder="Your username"
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
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <Link
                to={`/forgot-password${username.trim() ? `?username=${encodeURIComponent(username.trim())}` : ''}`}
                className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-300"
              >
                Forgot password?
              </Link>
            </div>
            <div className="relative">
              <Input
                id="password"
                name="password"
                type={shown ? 'text' : 'password'}
                placeholder="Your password"
                autoComplete="current-password"
                required
                maxLength={256}
                className="pr-16"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
                aria-invalid={error ? true : undefined}
              />
              <PasswordToggle shown={shown} onToggle={() => setShown((v) => !v)} />
            </div>
          </div>
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </Card>
      <p className="text-center text-sm text-slate-600 dark:text-slate-400">
        New to the hospital? Your account is created by the <strong>HR department</strong>. Ask HR
        for your username and first password.
      </p>
      <p className="text-center text-xs text-slate-500 dark:text-slate-400">
        After signing in you choose your department portal.
      </p>
    </AuthLayout>
  );
}
