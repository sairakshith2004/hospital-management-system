import {
  ROLE_CODES,
  ROLE_NAMES,
  type Department,
  type RoleCode,
  type StaffAccount,
} from '@hospitalos/shared';
import { useState } from 'react';
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
  | { kind: 'employment'; s: StaffAccount; to: string };

/** Staff and their logins. Roles are assigned by a Super Admin; nobody changes their own. */
export function StaffPage() {
  const { can, user } = useAuth();
  const q = useApi<{ staff: StaffAccount[] }>('/api/admin/staff');
  const depts = useApi<{ departments: Department[] }>('/api/departments');
  const [filter, setFilter] = useState('');
  const [adding, setAdding] = useState(false);
  const [act, setAct] = useState<Act | null>(null);
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({
    fullName: '',
    employeeNo: '',
    departmentId: '',
    designation: '',
    username: '',
    password: '',
  });
  const reload = ['/api/admin/staff'];
  const done = (m: string) => {
    setAct(null);
    setPassword('');
    setUsername('');
    setNotice(m);
  };
  const create = useAction('POST', '/api/admin/staff', {
    invalidate: reload,
    onSuccess: () => {
      setAdding(false);
      setForm({
        fullName: '',
        employeeNo: '',
        departmentId: '',
        designation: '',
        username: '',
        password: '',
      });
      setNotice('Staff member added. Assign a role so they can use HospitalOS.');
    },
  });
  const action = useAction<{ reason: string }>(
    'POST',
    () => {
      if (!act) return '';
      if (act.kind === 'status') return `/api/admin/users/${act.s.user!.id}/status`;
      if (act.kind === 'password') return `/api/admin/users/${act.s.user!.id}/password`;
      if (act.kind === 'role')
        return `/api/admin/users/${act.s.user!.id}/roles/${act.grant ? 'grant' : 'revoke'}`;
      if (act.kind === 'login') return `/api/admin/staff/${act.s.employeeId}/login`;
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
              : { status: act.to, reason };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Staff"
        actions={
          can('user:manage') &&
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
              id="st-user"
              label="Username (optional)"
              hint="Lowercase; leave empty for no login"
            >
              <Input
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase() })}
              />
            </FormField>
            <FormField
              id="st-pass"
              label="Initial password"
              hint="12+ characters; share it privately"
            >
              <Input
                type="password"
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </FormField>
          </div>
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
                create.pending
              }
              onClick={() =>
                create.run({
                  fullName: form.fullName,
                  employeeNo: form.employeeNo,
                  departmentId: form.departmentId,
                  designation: form.designation,
                  ...(form.username ? { username: form.username, password: form.password } : {}),
                  reason: 'New staff member',
                })
              }
            >
              Add
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
                        <Badge tone={s.user.status === 'active' ? 'success' : 'danger'}>
                          {s.user.status}
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
                        {can('user:manage') && s.user && (
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
                        {can('user:manage') && !s.user && s.employmentStatus !== 'exited' && (
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
              ? `${act.to === 'disabled' ? 'Disable' : 'Enable'} ${act.s.fullName}`
              : act.kind === 'password'
                ? `Reset password for ${act.s.fullName}`
                : act.kind === 'role'
                  ? `${act.grant ? 'Grant' : 'Revoke'} ${ROLE_NAMES[act.role as RoleCode] ?? act.role} — ${act.s.fullName}`
                  : act.kind === 'login'
                    ? `Create login for ${act.s.fullName}`
                    : `${act.s.fullName} has left`
        }
        description={
          act?.kind === 'status' && act.to === 'disabled'
            ? 'They are signed out at once.'
            : act?.kind === 'password'
              ? 'They are signed out at once and must use the new password.'
              : act?.kind === 'employment'
                ? 'Their login is disabled and they are signed out.'
                : undefined
        }
        confirmLabel="Confirm"
        reasonLabel="Reason (kept in the audit log)"
        pending={action.pending}
        error={action.error}
        onConfirm={(reason) => action.run(bodyFor(reason))}
      >
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
