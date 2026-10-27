/**
 * Staff managing their own password (2026-10-27):
 *   /forgot-password   ask for a reset link by username or work email (same answer either way)
 *   /reset-password    the link from the email: choose a new password
 *   /account/password  signed in: change it (required when HR or an administrator chose it)
 */
import { PASSWORD_RESET_MINUTES } from '@hospitalos/shared';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { apiFetch } from '../../lib/api';
import { errorMessage } from '../../lib/use-api';
import { useAuth } from './auth-context';
import { AuthLayout } from './AuthLayout';

const MIN = 12;

/** Checks a new password and its confirmation; returns what to fix, or null. */
export function checkNewPassword(password: string, confirm: string): string | null {
  if (password.length < MIN) return `Use at least ${MIN} characters.`;
  if (password.length > 256) return 'Use at most 256 characters.';
  if (password !== confirm) return 'The two passwords don’t match.';
  return null;
}

function Field({
  id,
  label,
  value,
  onChange,
  autoComplete,
  type = 'password',
}: {
  id: string;
  label: string;
  value: string;
  onChange(v: string): void;
  autoComplete: string;
  type?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        autoComplete={autoComplete}
        required
        maxLength={256}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

const backToSignIn = (
  <p className="text-center text-sm">
    <Link to="/login" className="font-semibold text-brand-700 hover:underline dark:text-brand-300">
      Back to sign in
    </Link>
  </p>
);

export function ForgotPasswordPage() {
  const [params] = useSearchParams();
  const [identifier, setIdentifier] = useState(params.get('username') ?? '');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await apiFetch('/api/auth/password/forgot', {
        method: 'POST',
        body: { identifier: identifier.trim() },
      });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthLayout
      title="Forgot your password?"
      subtitle="We’ll email a link to the work email HR has on file for you"
    >
      <Card className="space-y-4 shadow-lg shadow-brand-900/5">
        {sent ? (
          <Alert tone="success">
            If that account has a work email on file, a reset link is on its way. It works once, for{' '}
            {PASSWORD_RESET_MINUTES} minutes. Nothing arrived? Check spam, or ask HR to add your
            email.
          </Alert>
        ) : (
          <form className="space-y-4" onSubmit={(e) => void onSubmit(e)}>
            {error && <Alert tone="error">{error}</Alert>}
            <Field
              id="identifier"
              label="Username or work email"
              type="text"
              autoComplete="username"
              value={identifier}
              onChange={setIdentifier}
            />
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? 'Sending…' : 'Email me a reset link'}
            </Button>
          </form>
        )}
      </Card>
      {backToSignIn}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const problem = checkNewPassword(password, confirm);
    if (problem) return setError(problem);
    setError(null);
    setPending(true);
    try {
      await apiFetch('/api/auth/password/reset', { method: 'POST', body: { token, password } });
      navigate('/login?reset=1', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  }

  return (
    <AuthLayout title="Choose a new password" subtitle="This link works once">
      <Card className="shadow-lg shadow-brand-900/5">
        {!token ? (
          <Alert tone="error">
            This page needs the link from your email. <Link to="/forgot-password">Ask again</Link>.
          </Alert>
        ) : (
          <form className="space-y-4" onSubmit={(e) => void onSubmit(e)}>
            {error && <Alert tone="error">{error}</Alert>}
            <Field
              id="new-password"
              label="New password (12+ characters)"
              autoComplete="new-password"
              value={password}
              onChange={setPassword}
            />
            <Field
              id="confirm-password"
              label="Confirm new password"
              autoComplete="new-password"
              value={confirm}
              onChange={setConfirm}
            />
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? 'Saving…' : 'Set new password'}
            </Button>
          </form>
        )}
      </Card>
      {backToSignIn}
    </AuthLayout>
  );
}

export function ChangePasswordPage() {
  const { user, refresh, logout } = useAuth();
  const navigate = useNavigate();
  const forced = !!user?.mustChangePassword;
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const problem = checkNewPassword(password, confirm);
    if (problem) return setError(problem);
    setError(null);
    setPending(true);
    try {
      await apiFetch('/api/auth/password/change', {
        method: 'POST',
        body: { currentPassword: current, newPassword: password },
      });
      await refresh();
      setCurrent('');
      setPassword('');
      setConfirm('');
      if (forced) navigate('/portals', { replace: true });
      else setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthLayout
      title={forced ? 'Choose your own password' : 'Change your password'}
      subtitle={
        forced
          ? 'Your password was set by HR or an administrator. Pick one only you know before continuing.'
          : 'Other devices signed in to your account will be signed out.'
      }
    >
      <Card className="shadow-lg shadow-brand-900/5">
        <form className="space-y-4" onSubmit={(e) => void onSubmit(e)}>
          {done && <Alert tone="success">Password changed.</Alert>}
          {error && <Alert tone="error">{error}</Alert>}
          <Field
            id="current-password"
            label={forced ? 'Password you were given' : 'Current password'}
            autoComplete="current-password"
            value={current}
            onChange={setCurrent}
          />
          <Field
            id="new-password"
            label="New password (12+ characters)"
            autoComplete="new-password"
            value={password}
            onChange={setPassword}
          />
          <Field
            id="confirm-password"
            label="Confirm new password"
            autoComplete="new-password"
            value={confirm}
            onChange={setConfirm}
          />
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? 'Saving…' : 'Change password'}
          </Button>
        </form>
      </Card>
      <p className="text-center text-sm">
        {forced ? (
          <button
            type="button"
            onClick={() => void logout()}
            className="font-semibold text-brand-700 hover:underline dark:text-brand-300"
          >
            Sign out
          </button>
        ) : (
          <Link to="/" className="font-semibold text-brand-700 hover:underline dark:text-brand-300">
            Back to HospitalOS
          </Link>
        )}
      </p>
    </AuthLayout>
  );
}
