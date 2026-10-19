import { USERNAME_RULE } from '@hospitalos/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Select } from '../../components/ui/select';
import { ApiError, apiFetch } from '../../lib/api';
import { useAuth } from './auth-context';
import { AuthLayout, PasswordToggle } from './AuthLayout';

type Field = 'fullName' | 'username' | 'departmentId' | 'designation' | 'password' | 'confirm';
type Form = Record<Field, string>;
const EMPTY: Form = {
  fullName: '',
  username: '',
  departmentId: '',
  designation: '',
  password: '',
  confirm: '',
};

/** Checks the form before sending; returns a message per field that needs fixing. */
export function checkSignup(f: Form): Partial<Record<Field, string>> {
  const e: Partial<Record<Field, string>> = {};
  if (!f.fullName.trim()) e.fullName = 'Enter your full name';
  if (!USERNAME_RULE.test(f.username.trim()))
    e.username = '3–50 lowercase letters, digits, . _ or -, starting with a letter';
  if (!f.departmentId) e.departmentId = 'Choose your department';
  if (!f.designation.trim()) e.designation = 'Enter your job title';
  if (f.password.length < 12) e.password = 'At least 12 characters';
  if (f.confirm !== f.password) e.confirm = 'The passwords do not match';
  return e;
}

function without<T extends object>(o: T, key: keyof T): T {
  const copy = { ...o };
  delete copy[key];
  return copy;
}

/**
 * Create account, for new hospital staff. The account waits for an administrator's approval
 * and has no access until the Super Admin gives it a role; the server enforces both.
 */
export function SignupPage() {
  const { status } = useAuth();
  const navigate = useNavigate();
  const [f, setF] = useState(EMPTY);
  const [shown, setShown] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [departments, setDepartments] = useState<{ id: string; name: string }[] | null>(null);

  useEffect(() => {
    let active = true;
    apiFetch<{ departments: { id: string; name: string }[] }>('/api/auth/signup/departments', {
      ignoreUnauthorized: true,
    })
      .then((r) => active && setDepartments(r.departments))
      .catch(() => active && setDepartments([]));
    return () => {
      active = false;
    };
  }, []);

  if (status === 'signedIn') return <Navigate to="/portals" replace />;

  const set = (key: Field, value: string) => {
    setF((v) => ({ ...v, [key]: value }));
    setErrors((er) => without(er, key));
  };

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = checkSignup(f);
    setErrors(found);
    setError(null);
    if (Object.keys(found).length > 0 || sending) return;
    setSending(true);
    try {
      await apiFetch('/api/auth/signup', {
        method: 'POST',
        ignoreUnauthorized: true,
        body: {
          fullName: f.fullName.trim(),
          username: f.username.trim(),
          departmentId: f.departmentId,
          designation: f.designation.trim(),
          password: f.password,
        },
      });
      navigate(`/login?created=1&username=${encodeURIComponent(f.username.trim())}`, {
        replace: true,
      });
    } catch (err) {
      setF((v) => ({ ...v, password: '', confirm: '' }));
      if (err instanceof ApiError && err.code === 'USERNAME_TAKEN')
        setErrors({ username: 'That username is already taken. Try another.' });
      else if (err instanceof ApiError && err.status === 429)
        setError('Too many sign-ups from this computer. Try again later.');
      else if (err instanceof ApiError && err.status === 0) setError(err.message);
      else setError('Could not create the account. Please check the form and try again.');
      setSending(false);
    }
  }

  const fieldError = (key: Field) =>
    errors[key] && (
      <p id={`su-${key}-error`} className="text-xs text-red-700 dark:text-red-300">
        {errors[key]}
      </p>
    );
  const invalid = (key: Field) =>
    errors[key] ? { 'aria-invalid': true as const, 'aria-describedby': `su-${key}-error` } : {};

  return (
    <AuthLayout
      title="Create your account"
      subtitle="For new hospital staff. An administrator approves your account."
    >
      <Card className="shadow-lg shadow-brand-900/5">
        <form className="space-y-4" noValidate onSubmit={(e) => void onSubmit(e)}>
          {error && <Alert tone="error">{error}</Alert>}
          <div className="space-y-1.5">
            <Label htmlFor="su-fullName">Full name</Label>
            <Input
              id="su-fullName"
              autoComplete="name"
              maxLength={120}
              value={f.fullName}
              disabled={sending}
              onChange={(e) => set('fullName', e.target.value)}
              {...invalid('fullName')}
            />
            {fieldError('fullName')}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="su-username">Username</Label>
            <Input
              id="su-username"
              placeholder="e.g. priya.sharma"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={50}
              value={f.username}
              disabled={sending}
              onChange={(e) => set('username', e.target.value)}
              {...invalid('username')}
            />
            {fieldError('username')}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="su-departmentId">Department</Label>
              <Select
                id="su-departmentId"
                value={f.departmentId}
                disabled={sending || departments === null}
                onChange={(e) => set('departmentId', e.target.value)}
                {...invalid('departmentId')}
              >
                <option value="">{departments === null ? 'Loading…' : 'Choose…'}</option>
                {departments?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
              {fieldError('departmentId')}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="su-designation">Job title</Label>
              <Input
                id="su-designation"
                placeholder="e.g. Staff Nurse"
                maxLength={80}
                value={f.designation}
                disabled={sending}
                onChange={(e) => set('designation', e.target.value)}
                {...invalid('designation')}
              />
              {fieldError('designation')}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="su-password">Password</Label>
            <div className="relative">
              <Input
                id="su-password"
                type={shown ? 'text' : 'password'}
                autoComplete="new-password"
                maxLength={256}
                className="pr-16"
                value={f.password}
                disabled={sending}
                onChange={(e) => set('password', e.target.value)}
                {...invalid('password')}
              />
              <PasswordToggle shown={shown} onToggle={() => setShown((v) => !v)} />
            </div>
            {fieldError('password') ?? (
              <p className="text-xs text-slate-500 dark:text-slate-400">At least 12 characters.</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="su-confirm">Confirm password</Label>
            <Input
              id="su-confirm"
              type={shown ? 'text' : 'password'}
              autoComplete="new-password"
              maxLength={256}
              value={f.confirm}
              disabled={sending}
              onChange={(e) => set('confirm', e.target.value)}
              {...invalid('confirm')}
            />
            {fieldError('confirm')}
          </div>
          <Button type="submit" className="w-full" disabled={sending}>
            {sending ? 'Creating account…' : 'Create account'}
          </Button>
        </form>
      </Card>
      <p className="text-center text-sm text-slate-600 dark:text-slate-400">
        Already have an account?{' '}
        <Link
          to="/login"
          className="font-semibold text-brand-700 hover:underline dark:text-brand-300"
        >
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
