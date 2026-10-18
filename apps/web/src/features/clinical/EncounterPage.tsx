import {
  NOTE_KINDS,
  type EncounterView,
  type LabTestView,
  type PatientChart,
} from '@hospitalos/shared';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { NotFoundPage } from '../../app/NotFoundPage';
import { Alert } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { EmptyState } from '../../components/ui/empty-state';
import { FormField } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { PageHeader } from '../../components/ui/page-header';
import { Select } from '../../components/ui/select';
import { Spinner } from '../../components/ui/spinner';
import { Textarea } from '../../components/ui/textarea';
import { ApiError } from '../../lib/api';
import { addDays, ageInYears, formatDate, formatDateTime, sexLabel } from '../../lib/format';
import { useAction, useApi } from '../../lib/use-api';
import { hospitalToday } from '@hospitalos/shared';
import { useAuth } from '../auth/auth-context';
import { AllergyPanel } from './AllergyPanel';
import { PrescriptionBuilder } from './PrescriptionBuilder';
import { PrescriptionList } from './PrescriptionList';
import { VitalsForm } from './VitalsForm';
import { VitalsTable } from './VitalsTable';

function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

const NOTE_LABELS: Record<string, string> = {
  symptoms: 'Symptoms',
  observation: 'Observation',
  plan: 'Plan',
  addendum: 'Addendum',
};

/** The doctor's consultation workspace. Everything shown and saved goes through the API. */
export function EncounterPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const enc = useApi<{ encounter: EncounterView }>(`/api/encounters/${id}`);
  const patientId = enc.data?.encounter.patient.id;
  const chart = useApi<{ chart: PatientChart }>(
    patientId ? `/api/patients/${patientId}/chart` : null,
  );
  const tests = useApi<{ tests: LabTestView[] }>(can('lab_order:create') ? '/api/lab/tests' : null);
  const [noteKind, setNoteKind] = useState<string>('symptoms');
  const [noteBody, setNoteBody] = useState('');
  const [dx, setDx] = useState({ description: '', code: '', isPrimary: false });
  const [labTests, setLabTests] = useState<string[]>([]);
  const [fu, setFu] = useState({
    reason: '',
    dueFrom: addDays(hospitalToday(), 7),
    dueTo: addDays(hospitalToday(), 14),
  });
  const [completing, setCompleting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const reload = ['/api/encounters', '/api/patients'];
  const note = useAction('POST', `/api/encounters/${id}/notes`, {
    invalidate: reload,
    onSuccess: () => setNoteBody(''),
  });
  const diag = useAction('POST', `/api/encounters/${id}/diagnoses`, {
    invalidate: reload,
    onSuccess: () => setDx({ description: '', code: '', isPrimary: false }),
  });
  const lab = useAction('POST', `/api/encounters/${id}/lab-orders`, {
    invalidate: [...reload, '/api/lab'],
    onSuccess: () => {
      setLabTests([]);
      setNotice('Lab tests ordered.');
    },
  });
  const follow = useAction('POST', `/api/encounters/${id}/follow-ups`, {
    invalidate: reload,
    onSuccess: () => setNotice('Follow-up recommended. Reception will book it.'),
  });
  const complete = useAction('POST', `/api/encounters/${id}/complete`, {
    invalidate: [...reload, 'scheduling', '/api/encounters/mine'],
    onSuccess: () => {
      setCompleting(false);
      setNotice('Consultation completed.');
    },
  });

  if (enc.isPending) return <Spinner label="Loading consultation…" />;
  if (enc.isError) {
    if (enc.error instanceof ApiError && enc.error.status === 404) return <NotFoundPage />;
    return <Alert tone="error">{enc.error.message}</Alert>;
  }
  const e = enc.data.encounter;
  const open = e.status === 'in_progress';
  const p = e.patient;
  const orders = chart.data?.chart.labOrders ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${p.firstName} ${p.lastName}`}
        crumbs={[{ label: 'Queue', to: '/queue' }, { label: e.encounterNo }]}
        description={
          <>
            <span className="font-mono">{p.mrn}</span> · {ageInYears(p.dob)} y / {sexLabel(p.sex)} ·
            started {formatDateTime(e.startedAt)}
            {e.chiefComplaint ? ` · ${e.chiefComplaint}` : ''}
          </>
        }
        actions={
          <>
            <Badge tone={open ? 'warning' : 'success'}>{open ? 'In progress' : 'Completed'}</Badge>
            <Button asChild variant="secondary">
              <Link to={`/patients/${p.id}/chart`}>Full chart</Link>
            </Button>
            {open && <Button onClick={() => setCompleting(true)}>Complete consultation</Button>}
          </>
        }
      />
      {notice && <Alert tone="success">{notice}</Alert>}
      {chart.data && (
        <AllergyPanel
          patientId={p.id}
          allergies={chart.data.chart.allergies}
          editable={can('allergy:record')}
        />
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="Vital signs">
          {open && can('vitals:record') && <VitalsForm appointmentId={e.appointmentId} />}
          <VitalsTable vitals={e.vitals} />
        </Section>

        <Section title="Notes">
          {e.notes.length === 0 ? (
            <EmptyState title="No notes yet" />
          ) : (
            <ul className="space-y-2">
              {e.notes.map((n) => (
                <li key={n.id} className="rounded-md bg-slate-50 p-3 text-sm dark:bg-slate-800">
                  <span className="text-xs font-medium text-slate-500">
                    {NOTE_LABELS[n.kind]} · {n.author} · {formatDateTime(n.createdAt)}
                  </span>
                  <p className="mt-1 whitespace-pre-wrap">{n.body}</p>
                </li>
              ))}
            </ul>
          )}
          <form
            className="space-y-2"
            onSubmit={(ev) => {
              ev.preventDefault();
              note.run({ kind: open ? noteKind : 'addendum', body: noteBody });
            }}
          >
            {open && (
              <Select
                aria-label="Note type"
                value={noteKind}
                onChange={(ev) => setNoteKind(ev.target.value)}
              >
                {NOTE_KINDS.filter((k) => k !== 'addendum').map((k) => (
                  <option key={k} value={k}>
                    {NOTE_LABELS[k]}
                  </option>
                ))}
              </Select>
            )}
            <Textarea
              aria-label={open ? 'Note' : 'Addendum'}
              value={noteBody}
              onChange={(ev) => setNoteBody(ev.target.value)}
              maxLength={5000}
              placeholder={open ? 'Write a note' : 'Completed: add an addendum'}
            />
            {note.error && <Alert tone="error">{note.error}</Alert>}
            <Button type="submit" size="sm" disabled={!noteBody.trim() || note.pending}>
              {open ? 'Add note' : 'Add addendum'}
            </Button>
          </form>
        </Section>

        <Section title="Diagnoses">
          {e.diagnoses.length === 0 ? (
            <EmptyState title="No diagnoses yet" />
          ) : (
            <ul className="space-y-1 text-sm">
              {e.diagnoses.map((d) => (
                <li key={d.id}>
                  {d.isPrimary && <Badge tone="accent">Primary</Badge>} {d.description}
                  {d.code && (
                    <span className="ml-1 font-mono text-xs text-slate-500">{d.code}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {open && (
            <form
              className="grid gap-2 sm:grid-cols-[1fr_8rem_auto_auto] sm:items-end"
              onSubmit={(ev) => {
                ev.preventDefault();
                diag.run(dx);
              }}
            >
              <FormField id="dx-desc" label="Diagnosis">
                <Input
                  value={dx.description}
                  onChange={(ev) => setDx({ ...dx, description: ev.target.value })}
                />
              </FormField>
              <FormField id="dx-code" label="Code (optional)">
                <Input value={dx.code} onChange={(ev) => setDx({ ...dx, code: ev.target.value })} />
              </FormField>
              <label className="flex h-10 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={dx.isPrimary}
                  onChange={(ev) => setDx({ ...dx, isPrimary: ev.target.checked })}
                />{' '}
                Primary
              </label>
              <Button type="submit" disabled={!dx.description.trim() || diag.pending}>
                Add
              </Button>
              {diag.error && (
                <Alert tone="error" className="sm:col-span-4">
                  {diag.error}
                </Alert>
              )}
            </form>
          )}
        </Section>

        <Section title="Lab orders">
          {orders.length === 0 ? (
            <EmptyState title="No lab orders for this patient" />
          ) : (
            <ul className="space-y-1 text-sm">
              {orders.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-2">
                  <Link
                    className="text-brand-700 hover:underline dark:text-brand-400"
                    to={`/lab/orders/${o.id}`}
                  >
                    {o.test.name} <span className="font-mono text-xs">{o.orderNo}</span>
                  </Link>
                  <Badge
                    tone={
                      o.status === 'verified'
                        ? 'success'
                        : o.status === 'cancelled'
                          ? 'neutral'
                          : 'info'
                    }
                  >
                    {o.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          {open && can('lab_order:create') && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                {tests.data?.tests
                  .filter((t) => t.active)
                  .map((t) => (
                    <label
                      key={t.id}
                      className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1 text-sm dark:border-slate-700"
                    >
                      <input
                        type="checkbox"
                        checked={labTests.includes(t.id)}
                        onChange={(ev) =>
                          setLabTests((ls) =>
                            ev.target.checked ? [...ls, t.id] : ls.filter((x) => x !== t.id),
                          )
                        }
                      />
                      {t.name}
                    </label>
                  ))}
                {tests.data?.tests.length === 0 && (
                  <p className="text-sm text-slate-600">No lab tests are set up yet.</p>
                )}
              </div>
              {lab.error && <Alert tone="error">{lab.error}</Alert>}
              <Button
                size="sm"
                disabled={labTests.length === 0 || lab.pending}
                onClick={() => lab.run({ testIds: labTests, priority: 'routine' })}
              >
                Order {labTests.length || ''} test{labTests.length === 1 ? '' : 's'}
              </Button>
            </div>
          )}
        </Section>

        <Section title="Prescriptions">
          <PrescriptionList
            prescriptions={e.prescriptions}
            canCancel={can('prescription:cancel')}
          />
          {open && can('prescription:create') && (
            <PrescriptionBuilder
              encounterId={e.id}
              onDone={() => setNotice('Prescription issued to the pharmacy.')}
            />
          )}
        </Section>

        <Section title="Follow-up">
          {e.followUps.length > 0 && (
            <ul className="space-y-1 text-sm">
              {e.followUps.map((f) => (
                <li key={f.id}>
                  {f.reason} · {formatDate(f.dueFrom)}–{formatDate(f.dueTo)} ·{' '}
                  <Badge>{f.status}</Badge>
                </li>
              ))}
            </ul>
          )}
          {open && can('followup:recommend') && (
            <form
              className="grid gap-2 sm:grid-cols-3 sm:items-end"
              onSubmit={(ev) => {
                ev.preventDefault();
                follow.run(fu);
              }}
            >
              <div className="sm:col-span-3">
                <FormField id="fu-reason" label="Reason">
                  <Input
                    value={fu.reason}
                    onChange={(ev) => setFu({ ...fu, reason: ev.target.value })}
                  />
                </FormField>
              </div>
              <FormField id="fu-from" label="From">
                <Input
                  type="date"
                  value={fu.dueFrom}
                  onChange={(ev) => setFu({ ...fu, dueFrom: ev.target.value })}
                />
              </FormField>
              <FormField id="fu-to" label="To">
                <Input
                  type="date"
                  value={fu.dueTo}
                  onChange={(ev) => setFu({ ...fu, dueTo: ev.target.value })}
                />
              </FormField>
              <Button type="submit" disabled={!fu.reason.trim() || follow.pending}>
                Recommend
              </Button>
              {follow.error && (
                <Alert tone="error" className="sm:col-span-3">
                  {follow.error}
                </Alert>
              )}
            </form>
          )}
        </Section>
      </div>

      <ConfirmDialog
        open={completing}
        onOpenChange={setCompleting}
        title="Complete this consultation?"
        description="Notes and diagnoses are then locked; later corrections are added as addenda."
        confirmLabel="Complete consultation"
        pending={complete.pending}
        error={complete.error}
        onConfirm={() => complete.run(undefined)}
      />
    </div>
  );
}
