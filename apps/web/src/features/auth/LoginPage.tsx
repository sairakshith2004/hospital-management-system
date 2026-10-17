import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { ApiStatus } from '../../ApiStatus';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { PageSpinner } from '../../components/ui/spinner';
import { ApiError } from '../../lib/api';
import { useAuth } from './auth-context';
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
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === 'loading') return <PageSpinner label="Checking your session…" />;
  if (status === 'signedIn' && !submitting) return <Navigate to={next} replace />;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await login({ username: username.trim(), password });
      setPassword('');
      navigate(next, { replace: true });
    } catch (err) {
      setPassword('');
      setError(messageFor(err));
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12 dark:bg-slate-950">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">HospitalOS</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Staff sign in</p>
        </div>
        <Card>
          <form className="space-y-4" onSubmit={(e) => void onSubmit(e)}>
            {params.get('expired') === '1' && !error && (
              <Alert tone="info">Your session has ended. Please sign in again.</Alert>
            )}
            {params.get('signedOut') === '1' && !error && (
              <Alert tone="success">You have signed out.</Alert>
            )}
            {error && <Alert tone="error">{error}</Alert>}
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
                aria-invalid={error ? true : undefined}
              />
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </Card>
        <p className="text-center text-xs text-slate-500 dark:text-slate-400">
          Synthetic data only. Not for real patient information.
        </p>
        <ApiStatus compact />
      </div>
    </main>
  );
}
