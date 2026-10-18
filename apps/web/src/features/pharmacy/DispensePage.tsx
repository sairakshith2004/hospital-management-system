import type { Location } from '@hospitalos/shared';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { NotFoundPage } from '../../app/NotFoundPage';
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
import { ApiError } from '../../lib/api';
import { formatDate, formatDateTime, formatRupees } from '../../lib/format';
import { newKey, useAction, useApi } from '../../lib/use-api';
import { useAuth } from '../auth/auth-context';
import { RxStatus } from '../clinical/PrescriptionList';
import type { PharmacyPrescription } from './types';

/** Dispense against one prescription. The server picks batches first-expiry-first-out. */
export function DispensePage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const rxQ = useApi<{ prescription: PharmacyPrescription }>(`/api/pharmacy/prescriptions/${id}`);
  const locations = useApi<{ locations: Location[] }>('/api/locations');
  const pharmacies = useMemo(
    () => locations.data?.locations.filter((l) => l.kind === 'pharmacy') ?? [],
    [locations.data],
  );
  const [locationId, setLocationId] = useState('');
  const [qty, setQty] = useState<Record<string, string>>({});
  const [key, setKey] = useState(newKey);
  const [acks, setAcks] = useState({ nearExpiryAck: false, allergyAck: false });
  const [closing, setClosing] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const dispense = useAction<object, { dispenseNo: string }>(
    'POST',
    `/api/pharmacy/prescriptions/${id}/dispense`,
    {
      invalidate: ['/api/pharmacy', '/api/stock', '/api/invoices'],
      onSuccess: (res) => {
        setDone(`Dispensed: ${res.dispenseNo}. Stock and the patient's invoice are updated.`);
        setKey(newKey());
        setQty({});
        setAcks({ nearExpiryAck: false, allergyAck: false });
      },
    },
  );
  const close = useAction<{ reason: string }>('POST', `/api/pharmacy/prescriptions/${id}/close`, {
    invalidate: ['/api/pharmacy'],
    onSuccess: () => setClosing(false),
  });

  if (rxQ.isPending) return <Spinner label="Loading prescription…" />;
  if (rxQ.isError) {
    if (rxQ.error instanceof ApiError && rxQ.error.status === 404) return <NotFoundPage />;
    return <Alert tone="error">{rxQ.error.message}</Alert>;
  }
  const rx = rxQ.data.prescription;
  const open = rx.status === 'issued' || rx.status === 'partially_dispensed';
  const loc = locationId || pharmacies[0]?.id || '';
  const outstanding = (itemId: string) => {
    const i = rx.items.find((x) => x.id === itemId)!;
    return i.qtyPrescribed - i.qtyDispensed;
  };
  const amount = (itemId: string) => (qty[itemId] ?? String(outstanding(itemId))).trim();
  const lines = rx.items
    .filter((i) => outstanding(i.id) > 0 && Number(amount(i.id)) > 0)
    .map((i) => ({ prescriptionItemId: i.id, qty: Number(amount(i.id)) }));
  const send = (extra: Partial<typeof acks> = {}) => {
    const next = { ...acks, ...extra };
    setAcks(next);
    dispense.run({ locationId: loc, idempotencyKey: key, lines, ...next });
  };
  const needsAck = dispense.code === 'NEAR_EXPIRY' || dispense.code === 'ALLERGY_CONFLICT';

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Prescription ${rx.rxNo}`}
        crumbs={[{ label: 'Prescriptions', to: '/pharmacy' }, { label: rx.rxNo }]}
        description={
          <>
            {rx.patient.firstName} {rx.patient.lastName} (
            <span className="font-mono">{rx.patient.mrn}</span>) · {rx.doctor.fullName} ·{' '}
            {formatDateTime(rx.issuedAt)}
          </>
        }
        actions={
          <>
            <RxStatus status={rx.status} />
            {open && can('prescription:close') && (
              <Button variant="secondary" onClick={() => setClosing(true)}>
                Close prescription
              </Button>
            )}
          </>
        }
      />
      {rx.allergies.length > 0 && (
        <Alert tone="error">
          Allergies:{' '}
          {rx.allergies
            .map((a) => `${a.substance}${a.reaction ? ` (${a.reaction})` : ''}`)
            .join(', ')}
        </Alert>
      )}
      {done && <Alert tone="success">{done}</Alert>}
      {rx.notes && <p className="text-sm">Doctor&apos;s note: {rx.notes}</p>}
      <Card className="space-y-4">
        {open && (
          <FormField id="disp-loc" label="Dispense from">
            <Select value={loc} onChange={(e) => setLocationId(e.target.value)}>
              {pharmacies.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </FormField>
        )}
        <Table aria-label="Items">
          <thead>
            <tr>
              <Th>Medicine</Th>
              <Th>Directions</Th>
              <Th>Prescribed / given</Th>
              <Th>Usable batches (FEFO order)</Th>
              {open && <Th>Dispense now</Th>}
            </tr>
          </thead>
          <tbody>
            {rx.items.map((i) => {
              const batches =
                rx.availability
                  ?.find((a) => a.itemId === i.id)
                  ?.batches.filter((b) => b.location.id === loc) ?? [];
              const left = i.qtyPrescribed - i.qtyDispensed;
              return (
                <tr key={i.id}>
                  <Td className="font-medium">{i.product}</Td>
                  <Td className="text-xs">
                    {i.dose}, {i.frequency}, {i.route}
                    {i.durationDays ? `, ${i.durationDays} days` : ''}
                    {i.instructions && <span className="block">{i.instructions}</span>}
                  </Td>
                  <Td className="tabular-nums">
                    {i.qtyPrescribed} / {i.qtyDispensed}
                  </Td>
                  <Td className="text-xs">
                    {batches.length === 0 ? (
                      <Badge tone="danger">None at this location</Badge>
                    ) : (
                      batches.map((b) => (
                        <span key={b.id} className="block tabular-nums">
                          {b.batchNo} · exp {formatDate(b.expiryDate)} · {b.qtyOnHand} @{' '}
                          {formatRupees(b.salePricePaise)}
                        </span>
                      ))
                    )}
                  </Td>
                  {open && (
                    <Td>
                      {left > 0 ? (
                        <Input
                          aria-label={`Quantity of ${i.product}`}
                          className="w-24"
                          inputMode="numeric"
                          value={qty[i.id] ?? String(left)}
                          onChange={(e) => setQty({ ...qty, [i.id]: e.target.value })}
                        />
                      ) : (
                        <Badge tone="success">Done</Badge>
                      )}
                    </Td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </Table>
        {dispense.error && !needsAck && <Alert tone="error">{dispense.error}</Alert>}
        {open && can('prescription:dispense') && (
          <Button disabled={!loc || lines.length === 0 || dispense.pending} onClick={() => send()}>
            {dispense.pending ? 'Dispensing…' : 'Dispense'}
          </Button>
        )}
      </Card>

      {rx.dispensings && rx.dispensings.length > 0 && (
        <Card className="space-y-2">
          <h2 className="font-semibold">Dispensing history</h2>
          {rx.dispensings.map((d) => (
            <div key={d.id} className="text-sm">
              <span className="font-mono">{d.dispenseNo}</span> · {formatDateTime(d.dispensedAt)} ·{' '}
              {d.by}
              <ul className="ml-4 list-disc text-xs">
                {d.lines.map((l, n) => (
                  <li key={n}>
                    {l.product} · batch {l.batchNo} · {l.qty} @ {formatRupees(l.unitPricePaise)}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <Button asChild variant="ghost" size="sm">
            <Link to="/pharmacy">Back to prescriptions</Link>
          </Button>
        </Card>
      )}

      <ConfirmDialog
        open={needsAck}
        onOpenChange={(o) => !o && dispense.reset()}
        title={dispense.code === 'NEAR_EXPIRY' ? 'Near-expiry stock' : 'Allergy warning'}
        description={dispense.error ?? ''}
        confirmLabel="Dispense anyway"
        pending={dispense.pending}
        onConfirm={() =>
          send(dispense.code === 'NEAR_EXPIRY' ? { nearExpiryAck: true } : { allergyAck: true })
        }
      >
        <p className="text-sm">Your acknowledgement is recorded in the audit log.</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={closing}
        onOpenChange={setClosing}
        title="Close this prescription?"
        description="Items not yet dispensed won't be dispensed later."
        confirmLabel="Close prescription"
        reasonLabel="Reason"
        pending={close.pending}
        error={close.error}
        onConfirm={(reason) => close.run({ reason })}
      />
    </div>
  );
}
