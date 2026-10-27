import {
  ROLE_CODES,
  ROLE_NAMES,
  USERNAME_RULE,
  type Department,
  type RoleCode,
  type StaffAccount,
} from '@hospitalos/shared';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { Alert } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { FormField } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { PageHeader } from '../../components/ui/page-header';
import { Select } from '../../components/ui/select';
import { Spinner } from '../../components/ui/spinner';
import { Table, Td, Th } from '../../components/ui/table';
import { useAction, useApi } from '../../lib/use-api';
import { useAuth } from '../auth/auth-context';

type Act =
  | { kind: 'status'; s: StaffAccount; to: 'active' | 'disabled' }
  | { kind: 'password'; s: StaffAccount }
  | { kind: 'role'; s: StaffAccount; role: string; grant: boolean }
  | { kind: 'login'; s: StaffAccount }
  | { kind: 'email'; s: StaffAccount }
  | { kind: 'employment'; s: StaffAccount; to: string };

/** Staff and their logins. Roles are assigned by a Super Admin; nobody changes their own. */
export function StaffPage() {
  const { can, user } = useAuth();
  const q = useApi<{ staff: StaffAccount[] }>('/api/admin/staff');
  const depts = useApi<{ departments: Department[] }>('/api/departments');
  const [filter, setFilter] = useState('');
  // ?add=1 (the "Add new staff member" shortcut after sign-in) opens the form straight away.
  const [params] = useSearchParams();
  const [adding, setAdding] = useState(() => params.get('add') === '1' && can('user:create'));
  const [act, setAct] = useState<Act | null>(null);
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({
    fullName: '',
    employeeNo: '',
    departmentId: '',
    designation: '',
    email: '',
    username: '',
    password: '',
    /** Ticked only for someone who won't use HospitalOS (e.g. support staff HR tracks). */
    noLogin: false,
  });
  const usernameProblem =
    form.username && !USERNAME_RULE.test(form.username)
      ? '3–50 characters, starting with a letter: lowercase letters, digits, . _ or -'
      : null;
  const passwordProblem =
    form.password && form.password.length < 12 ? 'At least 12 characters' : null;
  const reload = ['/api/admin/staff'];
  const done = (m: string) => {
    setAct(null);
    setPassword('');
    setUsername('');
    setNotice(m);
  };
  const create = useAction<{ fullName: string; username?: string; [field: string]: unknown }>(
    'POST',
    '/api/admin/staff',
    {
      invalidate: reload,
      onSuccess: (_res, body) => {
        setAdding(false);
        setForm({
          fullName: '',
          employeeNo: '',
          departmentId: '',
          designation: '',
          email: '',
          username: '',
          password: '',
          noLogin: false,
        });
        setNotice(
          body.username
            ? `Account created for ${body.fullName}. They sign in as “${body.username}” with the password you set, and choose their own at first sign-in. The Super Admin then gives them a role.`
            : `${body.fullName} added without a login. Use “Create login” if they need to sign in later.`,
        );
      },
    },
  );
  const action = useAction<object>(
    'POST',
    () => {
      if (!act) return '';
      if (act.kind === 'status') return `/api/admin/users/${act.s.user!.id}/status`;
      if (act.kind === 'password') return `/api/admin/users/${act.s.user!.id}/password`;
      if (act.kind === 'role')
        return `/api/admin/users/${act.s.user!.id}/roles/${act.grant ? 'grant' : 'revoke'}`;
      if (act.kind === 'login') return `/api/admin/staff/${act.s.employeeId}/login`;
      if (act.kind === 'email') return `/api/admin/staff/${act.s.employeeId}/email`;
      return `/api/hr/employees/${act.s.employeeId}/status`;
    },
    { invalidate: reload, onSuccess: () => done('Saved.') },
  );
  const staff = q.data?.staff.filter(
    (s) =>
      !filter ||
      `${s.fullName} ${s.employeeNo} ${s.user?.username ?? ''}`
        .toLowerCase()
        .includes(filter.toLowerCase()),
  );
  const bodyFor = (reason: string) =>
    !act
      ? { reason }
      : act.kind === 'status'
        ? { status: act.to, reason }
        : act.kind === 'password'
          ? { password, reason }
          : act.kind === 'role'
            ? { roleCode: act.role, reason }
            : act.kind === 'login'
              ? { username, password, reason }
              : act.kind === 'email'
                ? { email: email.trim() || null }
                : { status: act.to, reason };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Staff"
        actions={
          can('user:create') &&
          !adding && <Button onClick={() => setAdding(true)}>Add staff member</Button>
        }
      />
      {notice && <Alert tone="success">{notice}</Alert>}
      {adding && (
        <Card className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField id="st-name" label="Full name" required>
              <Input
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              />
            </FormField>
            <FormField id="st-no" label="Employee no." required>
              <Input
                value={form.employeeNo}
                onChange={(e) => setForm({ ...form, employeeNo: e.target.value.toUpperCase() })}
              />
            </FormField>
            <FormField id="st-dept" label="Department" required>
              <Select
                value={form.departmentId}
                onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
              >
                <option value="">Choose…</option>
                {depts.data?.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField id="st-desig" label="Designation" required>
              <Input
                value={form.designation}
                onChange={(e) => setForm({ ...form, designation: e.target.value })}
              />
            </FormField>
            <FormField
              id="st-email"
              label="Work email (optional)"
              hint="Where password-reset links go"
            >
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </FormField>
            {!form.noLogin && (
              <>
                <FormField
                  id="st-user"
                  label="Username for signing in"
                  required
                  hint="Starts with a letter; lowercase letters, digits, . _ or -"
                  {...(usernameProblem && { error: usernameProblem })}
                >
                  <Input
                    autoComplete="off"
                    value={form.username}
                    onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase() })}
                  />
                </FormField>
                <FormField
                  id="st-pass"
                  label="First password"
                  required
                  hint="12+ characters; share it privately. They choose their own at first sign-in."
                  {...(passwordProblem && { error: passwordProblem })}
                >
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                  />
                </FormField>
              </>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={form.noLogin}
              onChange={(e) => setForm({ ...form, noLogin: e.target.checked })}
            />
            This person won’t use HospitalOS (record only, no login)
          </label>
          {create.error && <Alert tone="error">{create.error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                !form.fullName ||
                !form.employeeNo ||
                !form.departmentId ||
                !form.designation ||
                (!form.noLogin &&
                  (!form.username || !form.password || !!usernameProblem || !!passwordProblem)) ||
                create.pending
              }
              onClick={() =>
                create.run({
                  fullName: form.fullName,
                  employeeNo: form.employeeNo,
                  departmentId: form.departmentId,
                  designation: form.designation,
                  ...(form.email.trim() ? { email: form.email.trim() } : {}),
                  ...(form.noLogin ? {} : { username: form.username, password: form.password }),
                  reason: 'New staff member',
                })
              }
            >
              {form.noLogin ? 'Add staff record' : 'Add and create login'}
            </Button>
          </div>
        </Card>
      )}
      <div className="max-w-sm">
        <Input
          type="search"
          aria-label="Filter staff"
          placeholder="Filter by name, number or username"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      {q.isPending && <Spinner />}
      {q.isError && <Alert tone="error">{q.error.message}</Alert>}
      {staff && (
        <Table aria-label="Staff">
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Department</Th>
              <Th>Login</Th>
              <Th>Roles</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => {
              const self = s.user?.id === user?.id;
              const held = s.user?.roles ?? [];
              return (
                <tr key={s.employeeId} className="align-top">
                  <Td>
                    {s.fullName}
                    <span className="block text-xs text-slate-500">
                      {s.employeeNo} · {s.designation}
                      {s.email && <> · {s.email}</>}
                    </span>
                    {s.employmentStatus !== 'active' && (
                      <Badge tone="warning">{s.employmentStatus.replace('_', ' ')}</Badge>
                    )}
                  </Td>
                  <Td>{s.department.name}</Td>
                  <Td>
                    {s.user ? (
                      <>
                        <span className="font-mono text-sm">{s.user.username}</span>{' '}
                        <Badge
                          tone={
                            s.user.status === 'active'
                              ? 'success'
                              : s.user.status === 'pending'
                                ? 'warning'
                                : 'danger'
                          }
                        >
                          {s.user.status === 'pending' ? 'waiting for approval' : s.user.status}
                        </Badge>
                        {s.user.locked && <Badge tone="warning">locked</Badge>}
                      </>
                    ) : (
                      <span className="text-sm text-slate-500">No login</span>
                    )}
                  </Td>
                  <Td className="text-xs">
                    {held.length === 0 && s.user ? (
                      <Badge tone="warning">Awaiting role</Badge>
                    ) : (
                      held.map((r) => (
                        <Badge key={r} className="mr-1">
                          {ROLE_NAMES[r as RoleCode] ?? r}
                        </Badge>
                      ))
                    )}
                    {can('user_role:assign') && s.user && !self && (
                      <Select
                        aria-label={`Change roles of ${s.fullName}`}
                        className="mt-1 h-8 text-xs"
                        value=""
                        onChange={(e) => {
                          const [verb, role] = e.target.value.split(':') as [string, string];
                          setAct({ kind: 'role', s, role, grant: verb === 'grant' });
                        }}
                      >
                        <option value="">Grant / revoke role…</option>
                        {ROLE_CODES.filter((r) => !held.includes(r)).map((r) => (
                          <option key={`g${r}`} value={`grant:${r}`}>
                            Grant {ROLE_NAMES[r]}
                          </option>
                        ))}
                        {held.map((r) => (
                          <option key={`r${r}`} value={`revoke:${r}`}>
                            Revoke {ROLE_NAMES[r as RoleCode] ?? r}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Td>
                  <Td>
                    {!self && (
                      <div className="flex flex-wrap gap-1">
                        {can('user:manage') && s.user?.status === 'pending' && (
                          <>
                            <Button
                              size="sm"
                              onClick={() => setAct({ kind: 'status', s, to: 'active' })}
                            >
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setAct({ kind: 'status', s, to: 'disabled' })}
                            >
                              Reject
                            </Button>
                          </>
                        )}
                        {can('user:manage') && s.user && s.user.status !== 'pending' && (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                setAct({
                                  kind: 'status',
                                  s,
                                  to: s.user!.status === 'active' ? 'disabled' : 'active',
                                })
                              }
                            >
                              {s.user.status === 'active' ? 'Disable' : 'Enable'}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setAct({ kind: 'password', s })}
                            >
                              Reset password
                            </Button>
                          </>
                        )}
                        {(can('user:create') || can('user:manage')) && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEmail(s.email ?? '');
                              setAct({ kind: 'email', s });
                            }}
                          >
                            {s.email ? 'Edit email' : 'Set email'}
                          </Button>
                        )}
                        {can('user:create') && !s.user && s.employmentStatus !== 'exited' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setAct({ kind: 'login', s })}
                          >
                            Create login
                          </Button>
                        )}
                        {can('employee:manage') && s.employmentStatus !== 'exited' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setAct({ kind: 'employment', s, to: 'exited' })}
                          >
                            Mark as left
                          </Button>
                        )}
                      </div>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      <ConfirmDialog
        open={act !== null}
        onOpenChange={(o) => !o && setAct(null)}
        title={
          !act
            ? ''
            : act.kind === 'status'
              ? `${
                  act.s.user?.status === 'pending'
                    ? act.to === 'active'
                      ? 'Approve'
                      : 'Reject'
                    : act.to === 'disabled'
                      ? 'Disable'
                      : 'Enable'
                } ${act.s.fullName}`
              : act.kind === 'password'
                ? `Reset password for ${act.s.fullName}`
                : act.kind === 'role'
                  ? `${act.grant ? 'Grant' : 'Revoke'} ${ROLE_NAMES[act.role as RoleCode] ?? act.role} — ${act.s.fullName}`
                  : act.kind === 'login'
                    ? `Create login for ${act.s.fullName}`
                    : act.kind === 'email'
                      ? `Work email for ${act.s.fullName}`
                      : `${act.s.fullName} has left`
        }
        description={
          act?.kind === 'status' && act.s.user?.status === 'pending'
            ? act.to === 'active'
              ? `They can sign in, but have no access until the Super Admin gives them a role. Signed up for ${act.s.department.name} as ${act.s.designation}.`
              : 'The account stays disabled and cannot sign in.'
            : act?.kind === 'status' && act.to === 'disabled'
              ? 'They are signed out at once.'
              : act?.kind === 'password'
                ? 'They are signed out at once, and must choose their own password when they next sign in.'
                : act?.kind === 'email'
                  ? 'Password-reset links go here. Leave empty to remove it.'
                  : act?.kind === 'employment'
                    ? 'Their login is disabled and they are signed out.'
                    : undefined
        }
        confirmLabel="Confirm"
        {...(act?.kind !== 'email' && { reasonLabel: 'Reason (kept in the audit log)' })}
        pending={action.pending}
        error={action.error}
        onConfirm={(reason) => action.run(bodyFor(reason))}
      >
        {act?.kind === 'email' && (
          <FormField id="lg-email" label="Work email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </FormField>
        )}
        {act?.kind === 'login' && (
          <FormField id="lg-user" label="Username" required>
            <Input value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} />
          </FormField>
        )}
        {(act?.kind === 'password' || act?.kind === 'login') && (
          <FormField id="lg-pass" label="New password" required hint="12+ characters">
            <Input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </FormField>
        )}
      </ConfirmDialog>
    </div>
  );
}
