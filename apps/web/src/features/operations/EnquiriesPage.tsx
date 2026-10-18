import { ENQUIRY_CHANNELS, type PatientSummary } from '@hospitalos/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { Alert } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Dialog } from '../../components/ui/dialog';
import { EmptyState } from '../../components/ui/empty-state';
import { FormField } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { PageHeader } from '../../components/ui/page-header';
import { Select } from '../../components/ui/select';
import { Table, Td, Th } from '../../components/ui/table';
import { Tabs } from '../../components/ui/tabs';
import { formatDate, formatDateTime } from '../../lib/format';
import { useAction, useApi } from '../../lib/use-api';
import { useAuth } from '../auth/auth-context';
import { PatientPicker } from '../patients/PatientPicker';

interface Enquiry {
  id: string;
  enquiryNo: string;
  name: string;
  phone: string;
  channel: string;
  subject: string;
  notes: string | null;
  status: string;
  createdAt: string;
  referralSource: { name: string } | null;
  campaign: { name: string } | null;
  convertedPatient: { id: string; mrn: string } | null;
  openFollowUps: number;
}

/** Patient enquiries: contact details and follow-up notes only, never clinical data. */
export function EnquiriesPage() {
  const { can } = useAuth();
  const [status, setStatus] = useState<'' | 'open' | 'follow_up' | 'converted' | 'closed'>('');
  const q = useApi<{ enquiries: Enquiry[] }>(`/api/enquiries${status ? `?status=${status}` : ''}`);
  const sources = useApi<{ sources: { id: string; name: string; active: boolean }[] }>(
    '/api/referral-sources',
  );
  const campaigns = useApi<{ campaigns: { id: string; name: string; status: string }[] }>(
    '/api/campaigns',
  );
  const [f, setF] = useState({
    name: '',
    phone: '',
    channel: 'phone',
    referralSourceId: '',
    campaignId: '',
    subject: '',
    notes: '',
  });
  const [open, setOpen] = useState<Enquiry | null>(null);
  const [source, setSource] = useState('');
  const add = useAction('POST', '/api/enquiries', {
    invalidate: ['/api/enquiries', '/api/campaigns'],
    onSuccess: () =>
      setF({
        name: '',
        phone: '',
        channel: 'phone',
        referralSourceId: '',
        campaignId: '',
        subject: '',
        notes: '',
      }),
  });
  const addSource = useAction('POST', '/api/referral-sources', {
    invalidate: ['/api/referral-sources'],
    onSuccess: () => setSource(''),
  });
  return (
    <div className="space-y-4">
      <PageHeader title="Enquiries" />
      <Card className="space-y-3">
        <form
          className="grid gap-3 sm:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            add.run({
              ...f,
              referralSourceId: f.referralSourceId || null,
              campaignId: f.campaignId || null,
            });
          }}
        >
          <FormField id="en-name" label="Name" required>
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </FormField>
          <FormField id="en-phone" label="Phone" required>
            <Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          </FormField>
          <FormField id="en-ch" label="Channel">
            <Select value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}>
              {ENQUIRY_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {c.replace('_', ' ')}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField id="en-src" label="Referral source">
            <Select
              value={f.referralSourceId}
              onChange={(e) => setF({ ...f, referralSourceId: e.target.value })}
            >
              <option value="">—</option>
              {sources.data?.sources
                .filter((s) => s.active)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </Select>
          </FormField>
          <FormField id="en-camp" label="Campaign">
            <Select
              value={f.campaignId}
              onChange={(e) => setF({ ...f, campaignId: e.target.value })}
            >
              <option value="">—</option>
              {campaigns.data?.campaigns
                .filter((c) => c.status !== 'completed')
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </Select>
          </FormField>
          <div className="sm:col-span-2">
            <FormField id="en-subj" label="Subject" required>
              <Input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} />
            </FormField>
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={!f.name || !f.phone || !f.subject || add.pending}>
              Log enquiry
            </Button>
          </div>
        </form>
        {add.error && <Alert tone="error">{add.error}</Alert>}
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            addSource.run({ name: source });
          }}
        >
          <FormField id="src-new" label="New referral source">
            <Input value={source} onChange={(e) => setSource(e.target.value)} />
          </FormField>
          <Button type="submit" variant="secondary" disabled={!source.trim() || addSource.pending}>
            Add source
          </Button>
        </form>
      </Card>
      <Tabs
        label="Status"
        value={status}
        onChange={setStatus}
        tabs={[
          { value: '', label: 'All' },
          { value: 'open', label: 'Open' },
          { value: 'follow_up', label: 'Following up' },
          { value: 'converted', label: 'Converted' },
          { value: 'closed', label: 'Closed' },
        ]}
      />
      {q.data && q.data.enquiries.length === 0 && <EmptyState title="No enquiries" />}
      {q.data && q.data.enquiries.length > 0 && (
        <Table aria-label="Enquiries">
          <thead>
            <tr>
              <Th>Enquiry</Th>
              <Th>Contact</Th>
              <Th>Source</Th>
              <Th>Status</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {q.data.enquiries.map((e) => (
              <tr key={e.id}>
                <Td>
                  <span className="font-mono text-xs">{e.enquiryNo}</span> {e.subject}
                  <span className="block text-xs text-slate-500">
                    {formatDateTime(e.createdAt)}
                  </span>
                </Td>
                <Td>
                  {e.name}
                  <span className="block text-xs">
                    {e.phone} · {e.channel.replace('_', ' ')}
                  </span>
                </Td>
                <Td className="text-xs">
                  {e.referralSource?.name ?? ''} {e.campaign ? `· ${e.campaign.name}` : ''}
                </Td>
                <Td>
                  <Badge
                    tone={
                      e.status === 'converted'
                        ? 'success'
                        : e.status === 'closed'
                          ? 'neutral'
                          : 'info'
                    }
                  >
                    {e.status.replace('_', ' ')}
                  </Badge>
                  {e.convertedPatient && can('patient:read_demographics') && (
                    <Link
                      className="ml-1 font-mono text-xs text-brand-700 underline"
                      to={`/patients/${e.convertedPatient.id}`}
                    >
                      {e.convertedPatient.mrn}
                    </Link>
                  )}
                  {e.openFollowUps > 0 && (
                    <Badge tone="warning" className="ml-1">
                      {e.openFollowUps} to do
                    </Badge>
                  )}
                </Td>
                <Td>
                  <Button size="sm" variant="ghost" onClick={() => setOpen(e)}>
                    Open
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {open && <EnquiryDialog enquiry={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function EnquiryDialog({ enquiry: e, onClose }: { enquiry: Enquiry; onClose(): void }) {
  const { can } = useAuth();
  const follow = useApi<{
    followUps: {
      id: string;
      note: string;
      dueOn: string | null;
      done: boolean;
      createdBy: string;
      createdAt: string;
    }[];
  }>(`/api/enquiries/${e.id}/follow-ups`);
  const [note, setNote] = useState('');
  const [due, setDue] = useState('');
  const [patient, setPatient] = useState<PatientSummary | null>(null);
  const reload = ['/api/enquiries', '/api/campaigns'];
  const addNote = useAction('POST', `/api/enquiries/${e.id}/follow-ups`, {
    invalidate: reload,
    onSuccess: () => {
      setNote('');
      setDue('');
    },
  });
  const done = useAction<{ id: string }>('POST', (b) => `/api/enquiry-follow-ups/${b.id}/done`, {
    invalidate: reload,
  });
  const setStatus = useAction('POST', `/api/enquiries/${e.id}/status`, {
    invalidate: reload,
    onSuccess: onClose,
  });
  const err = addNote.error ?? done.error ?? setStatus.error;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${e.enquiryNo} · ${e.name}`}
      description={e.subject}
      className="max-w-2xl"
    >
      {e.notes && <p className="text-sm">{e.notes}</p>}
      <ul className="space-y-1 text-sm">
        {follow.data?.followUps.map((f) => (
          <li key={f.id} className={f.done ? 'text-slate-500 line-through' : ''}>
            {f.note} {f.dueOn && `· due ${formatDate(f.dueOn)}`} · {f.createdBy}
            {!f.done && (
              <button
                type="button"
                className="ml-2 text-xs underline"
                onClick={() => done.run({ id: f.id })}
              >
                done
              </button>
            )}
          </li>
        ))}
      </ul>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(ev) => {
          ev.preventDefault();
          addNote.run({ note, dueOn: due || null });
        }}
      >
        <Input
          aria-label="Follow-up note"
          className="flex-1"
          value={note}
          onChange={(ev) => setNote(ev.target.value)}
          placeholder="Next step"
        />
        <Input
          aria-label="Due"
          type="date"
          className="w-40"
          value={due}
          onChange={(ev) => setDue(ev.target.value)}
        />
        <Button type="submit" disabled={!note.trim() || addNote.pending}>
          Add
        </Button>
      </form>
      {e.status !== 'converted' && e.status !== 'closed' && (
        <div className="space-y-2 border-t border-slate-200 pt-3 dark:border-slate-700">
          {can('patient:read_demographics') && (
            <>
              <PatientPicker id="enq-patient" value={patient} onChange={setPatient} />
              <Button
                size="sm"
                disabled={!patient || setStatus.pending}
                onClick={() =>
                  setStatus.run({ status: 'converted', convertedPatientId: patient!.id })
                }
              >
                Mark converted (registered patient)
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" onClick={() => setStatus.run({ status: 'closed' })}>
            Close enquiry
          </Button>
        </div>
      )}
      {err && <Alert tone="error">{err}</Alert>}
    </Dialog>
  );
}
