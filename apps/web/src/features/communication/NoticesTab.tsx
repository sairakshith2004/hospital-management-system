import {
  NOTICE_AUDIENCES,
  ROLE_CODES,
  ROLE_NAMES,
  type NoticeAudience,
  type NoticePriority,
  type RoleCode,
} from '@hospitalos/shared';
import { useState, type FormEvent } from 'react';
import { Alert } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { Spinner } from '../../components/ui/spinner';
import { Textarea } from '../../components/ui/textarea';
import { formatDateTime } from '../../lib/format';
import { useAction, useApi } from '../../lib/use-api';
import { cn } from '../../lib/utils';
import { useAuth } from '../auth/auth-context';
import { COMM, type Notice, type StaffMember } from './comm-api';
import { StaffPicker } from './StaffPicker';

const AUDIENCE_LABELS: Record<NoticeAudience, string> = {
  all: 'All staff',
  role: 'One role (e.g. all doctors)',
  department: 'One department',
  user: 'One person',
};

export function NoticesTab() {
  const { can } = useAuth();
  const [writing, setWriting] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const { data, isLoading, error } = useApi<{ notices: Notice[] }>(`${COMM}/notices`);
  const markRead = useAction<{ id: string }>('POST', (b) => `${COMM}/notices/${b.id}/read`, {
    invalidate: [`${COMM}/notices`, `${COMM}/summary`],
  });

  if (writing) return <NoticeForm onDone={() => setWriting(false)} />;

  function toggle(n: Notice) {
    setOpenId((cur) => (cur === n.id ? null : n.id));
    if (!n.read) markRead.run({ id: n.id });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 dark:border-slate-800">
        <p className="text-sm text-slate-500">Official notices (last 90 days)</p>
        {can('notice:publish') && (
          <Button size="sm" onClick={() => setWriting(true)}>
            New notice
          </Button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {isLoading && <Spinner className="m-4" />}
        {error && <Alert tone="error">Couldn't load notices.</Alert>}
        {data?.notices.length === 0 && (
          <p className="p-4 text-sm text-slate-500">No notices for you right now.</p>
        )}
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {data?.notices.map((n) => (
            <li
              key={n.id}
              className={cn(
                n.priority === 'urgent' &&
                  'border-l-4 border-red-400 bg-red-50/50 dark:bg-red-950/20',
              )}
            >
              <button
                type="button"
                aria-expanded={openId === n.id}
                onClick={() => toggle(n)}
                className="w-full px-3 py-2.5 text-left hover:bg-sky-50/60 dark:hover:bg-slate-800"
              >
                <span className="flex items-start justify-between gap-2">
                  <span className={cn('text-sm', !n.read && 'font-semibold')}>
                    {!n.read && (
                      <span
                        aria-label="Unread"
                        className="mr-1.5 inline-block size-2 rounded-full bg-sky-500"
                      />
                    )}
                    {n.title}
                  </span>
                  {n.priority === 'urgent' && <Badge tone="danger">Urgent</Badge>}
                </span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  {n.author} · {formatDateTime(n.createdAt)} · to{' '}
                  {n.audience === 'role'
                    ? (ROLE_NAMES[n.audienceLabel as RoleCode] ?? n.audienceLabel)
                    : n.audienceLabel}
                </span>
              </button>
              {openId === n.id && (
                <p className="px-3 pb-3 text-sm whitespace-pre-wrap text-slate-700 dark:text-slate-200">
                  {n.body}
                </p>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function NoticeForm({ onDone }: { onDone(): void }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState<NoticePriority>('normal');
  const [audience, setAudience] = useState<NoticeAudience>('all');
  const [roleCode, setRoleCode] = useState<RoleCode>('DOC');
  const [departmentId, setDepartmentId] = useState('');
  const [person, setPerson] = useState<StaffMember | null>(null);
  const departments = useApi<{ departments: { id: string; name: string }[] }>(
    audience === 'department' ? `${COMM}/departments` : null,
  );
  const publish = useAction<object>('POST', `${COMM}/notices`, {
    invalidate: [`${COMM}/notices`],
    onSuccess: onDone,
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    publish.run({
      title,
      body,
      priority,
      audience,
      ...(audience === 'role' && { roleCode }),
      ...(audience === 'department' && departmentId && { departmentId }),
      ...(audience === 'user' && person && { userId: person.id }),
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">New official notice</p>
        <Button variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
      <Input
        aria-label="Title"
        placeholder="Title"
        maxLength={150}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
      />
      <Textarea
        aria-label="Notice"
        placeholder="Write the notice…"
        rows={5}
        maxLength={4000}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        required
      />
      <div className="grid grid-cols-2 gap-2">
        <Select
          aria-label="Send to"
          value={audience}
          onChange={(e) => setAudience(e.target.value as NoticeAudience)}
        >
          {NOTICE_AUDIENCES.map((a) => (
            <option key={a} value={a}>
              {AUDIENCE_LABELS[a]}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Priority"
          value={priority}
          onChange={(e) => setPriority(e.target.value as NoticePriority)}
        >
          <option value="normal">Normal</option>
          <option value="urgent">Urgent</option>
        </Select>
      </div>
      {audience === 'role' && (
        <Select
          aria-label="Role"
          value={roleCode}
          onChange={(e) => setRoleCode(e.target.value as RoleCode)}
        >
          {ROLE_CODES.map((r) => (
            <option key={r} value={r}>
              {ROLE_NAMES[r]}
            </option>
          ))}
        </Select>
      )}
      {audience === 'department' && (
        <Select
          aria-label="Department"
          value={departmentId}
          onChange={(e) => setDepartmentId(e.target.value)}
          required
        >
          <option value="">Choose a department…</option>
          {departments.data?.departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
      )}
      {audience === 'user' &&
        (person ? (
          <p className="flex items-center justify-between text-sm">
            To: <strong>{person.fullName}</strong>
            <Button variant="ghost" size="sm" onClick={() => setPerson(null)}>
              Change
            </Button>
          </p>
        ) : (
          <StaffPicker onPick={setPerson} label="Search for the recipient" />
        ))}
      {publish.error && <Alert tone="error">{publish.error}</Alert>}
      <Button type="submit" disabled={publish.pending || (audience === 'user' && !person)}>
        {publish.pending ? 'Publishing…' : 'Publish notice'}
      </Button>
    </form>
  );
}
