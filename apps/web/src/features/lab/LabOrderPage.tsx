import type { LabOrderView, LabTestView } from '@hospitalos/shared';
import { useState } from 'react';
import { useParams } from 'react-router';
import { ForbiddenPage } from '../../app/ForbiddenPage';
import { NotFoundPage } from '../../app/NotFoundPage';
import { Alert } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { FormField } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { PageHeader } from '../../components/ui/page-header';
import { Spinner } from '../../components/ui/spinner';
import { Table, Td, Th } from '../../components/ui/table';
import { ApiError } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useAction, useApi } from '../../lib/use-api';
import { useAuth } from '../auth/auth-context';
import { LabStatus } from './LabWorklistPage';

const range = (lo: string | null, hi: string | null, txt: string | null) =>
  txt ??
  (lo !== null || hi !== null
    ? `${lo !== null ? Number(lo) : ''}–${hi !== null ? Number(hi) : ''}`
    : '—');

export function LabOrderPage() {
  const { id = '' } = useParams();
  const { can, user } = useAuth();
  const q = useApi<{ order: LabOrderView }>(`/api/lab/orders/${id}`, { retry: false });
  const tests = useApi<{ tests: LabTestView[] }>(can('lab_result:enter') ? '/api/lab/tests' : null);
  const [barcode, setBarcode] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [cancelling, setCancelling] = useState(false);
  const reload = ['/api/lab', '/api/patients', '/api/encounters'];
  const collect = useAction('POST', `/api/lab/orders/${id}/collect`, { invalidate: reload });
  const enter = useAction('POST', `/api/lab/orders/${id}/results`, {
    invalidate: reload,
    onSuccess: () => setValues({}),
  });
  const verify = useAction('POST', `/api/lab/orders/${id}/verify`, { invalidate: reload });
  const cancel = useAction<{ reason: string }>('POST', `/api/lab/orders/${id}/cancel`, {
    invalidate: reload,
    onSuccess: () => setCancelling(false),
  });

  if (q.isPending) return <Spinner />;
  if (q.isError) {
    if (q.error instanceof ApiError && q.error.status === 404) return <NotFoundPage />;
    if (q.error instanceof ApiError && q.error.status === 403) return <ForbiddenPage />;
    return <Alert tone="error">{q.error.message}</Alert>;
  }
  const o = q.data.order;
  const params = tests.data?.tests.find((t) => t.id === o.test.id)?.parameters ?? [];
  const canEnter = can('lab_result:enter') && (o.status === 'collected' || o.status === 'resulted');
  const err = collect.error ?? enter.error ?? verify.error;
  return (
    <div className="space-y-4">
      <PageHeader
        title={`${o.test.name}`}
        crumbs={[
          {
            label: can('lab:process') || can('lab_result:enter') ? 'Lab worklist' : 'Chart',
            to:
              can('lab:process') || can('lab_result:enter')
                ? '/lab'
                : `/patients/${o.patient.id}/chart`,
          },
          { label: o.orderNo },
        ]}
        description={
          <>
            {o.patient.firstName} {o.patient.lastName} (
            <span className="font-mono">{o.patient.mrn}</span>) · ordered by {o.orderedBy} ·{' '}
            {formatDateTime(o.orderedAt)}
          </>
        }
        actions={
          <>
            <LabStatus status={o.status} />
            {o.priority === 'urgent' && <Badge tone="danger">Urgent</Badge>}
            {can('lab_order:cancel') && (o.status === 'ordered' || o.status === 'collected') && (
              <Button variant="secondary" onClick={() => setCancelling(true)}>
                Cancel order
              </Button>
            )}
          </>
        }
      />
      {o.clinicalNotes && <p className="text-sm">Clinical note: {o.clinicalNotes}</p>}
      {err && <Alert tone="error">{err}</Alert>}
      {o.status === 'ordered' && can('lab:process') && (
        <Card>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              collect.run({ sampleBarcode: barcode });
            }}
          >
            <FormField id="lab-barcode" label="Sample barcode" required>
              <Input value={barcode} onChange={(e) => setBarcode(e.target.value)} />
            </FormField>
            <Button type="submit" disabled={!barcode.trim() || collect.pending}>
              Mark sample collected
            </Button>
          </form>
        </Card>
      )}
      <Card className="space-y-3">
        <h2 className="font-semibold">Results</h2>
        {o.sampleBarcode && (
          <p className="text-sm">
            Sample {o.sampleBarcode} · collected{' '}
            {o.collectedAt ? formatDateTime(o.collectedAt) : ''}
          </p>
        )}
        <Table aria-label="Results">
          <thead>
            <tr>
              <Th>Parameter</Th>
              <Th>Value</Th>
              <Th>Reference</Th>
              <Th>Flag</Th>
              {canEnter && <Th>{o.status === 'resulted' ? 'Correct value' : 'Enter value'}</Th>}
            </tr>
          </thead>
          <tbody>
            {(params.length
              ? params
              : o.results.map((r) => ({
                  id: r.parameterId,
                  name: r.parameter,
                  unit: r.unit,
                  refLow: r.refLow,
                  refHigh: r.refHigh,
                  refText: r.refText,
                }))
            ).map((p) => {
              const r = o.results.find((x) => x.parameterId === p.id);
              return (
                <tr key={p.id}>
                  <Td>{p.name}</Td>
                  <Td className="tabular-nums">
                    {r ? (r.valueNum !== null ? Number(r.valueNum) : r.valueText) : '—'}{' '}
                    {r?.unit ?? p.unit ?? ''}
                  </Td>
                  <Td>{range(p.refLow, p.refHigh, p.refText)}</Td>
                  <Td>
                    {r?.abnormalFlag && (
                      <Badge tone={r.abnormalFlag === 'normal' ? 'success' : 'danger'}>
                        {r.abnormalFlag}
                      </Badge>
                    )}
                  </Td>
                  {canEnter && (
                    <Td>
                      <Input
                        aria-label={`Value for ${p.name}`}
                        className="w-32"
                        value={values[p.id] ?? ''}
                        onChange={(e) => setValues({ ...values, [p.id]: e.target.value })}
                      />
                    </Td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </Table>
        {canEnter && (
          <Button
            disabled={enter.pending || Object.values(values).every((v) => !v.trim())}
            onClick={() =>
              enter.run({
                results: Object.entries(values)
                  .filter(([, v]) => v.trim())
                  .map(([parameterId, v]) =>
                    /^-?\d+(\.\d+)?$/.test(v.trim())
                      ? { parameterId, valueNum: Number(v) }
                      : { parameterId, valueText: v.trim() },
                  ),
              })
            }
          >
            Save results
          </Button>
        )}
        {o.resultedAt && (
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Entered by {o.resultedBy} · {formatDateTime(o.resultedAt)}
            {o.verifiedAt && ` · verified by ${o.verifiedBy} · ${formatDateTime(o.verifiedAt)}`}
          </p>
        )}
        {o.status === 'resulted' &&
          can('lab_result:verify') &&
          (o.resultedBy === user?.fullName ? (
            <p className="text-sm text-slate-600">
              Another member of the lab must verify these results.
            </p>
          ) : (
            <Button disabled={verify.pending} onClick={() => verify.run(undefined)}>
              Verify results
            </Button>
          ))}
        {o.status === 'cancelled' && <Alert>Cancelled: {o.cancelReason}</Alert>}
      </Card>
      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title="Cancel lab order"
        description="Its charge is removed from the visit's draft invoice."
        confirmLabel="Cancel order"
        reasonLabel="Reason"
        pending={cancel.pending}
        error={cancel.error}
        onConfirm={(reason) => cancel.run({ reason })}
      />
    </div>
  );
}
