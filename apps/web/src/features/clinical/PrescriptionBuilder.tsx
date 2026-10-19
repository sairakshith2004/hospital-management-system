import type { StockItemView } from '@hospitalos/shared';
import { useEffect, useState } from 'react';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Spinner } from '../../components/ui/spinner';
import { useAction, useApi } from '../../lib/use-api';

interface Line {
  medicineProductId: string;
  name: string;
  available: number;
  dose: string;
  frequency: string;
  route: string;
  durationDays: string;
  qtyPrescribed: string;
  instructions: string;
}

export function ingredientsLabel(item: StockItemView) {
  return (
    item.medicine?.ingredients
      .map((i) => `${i.name} ${Number(i.strengthValue)} ${i.strengthUnit}`)
      .join(' + ') ?? ''
  );
}

/** Search the catalogue (any brand, ingredient or strength) and build a prescription. */
export function PrescriptionBuilder({
  encounterId,
  onDone,
}: {
  encounterId: string;
  onDone(): void;
}) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const results = useApi<{ items: StockItemView[] }>(
    debounced.length >= 2 ? `/api/stock?q=${encodeURIComponent(debounced)}&kind=medicine` : null,
  );
  const [lines, setLines] = useState<Line[]>([]);
  const [notes, setNotes] = useState('');
  const [askAllergy, setAskAllergy] = useState(false);
  const submit = useAction<object, { prescriptionId: string }>(
    'POST',
    `/api/encounters/${encounterId}/prescriptions`,
    {
      invalidate: ['/api/encounters', '/api/patients'],
      onSuccess: () => {
        setLines([]);
        setNotes('');
        setAskAllergy(false);
        onDone();
      },
    },
  );
  const body = (ack: boolean) => ({
    notes,
    allergyAcknowledged: ack,
    items: lines.map((l) => ({
      medicineProductId: l.medicineProductId,
      dose: l.dose,
      frequency: l.frequency,
      route: l.route,
      durationDays: l.durationDays ? Number(l.durationDays) : null,
      qtyPrescribed: Number(l.qtyPrescribed),
      instructions: l.instructions,
    })),
  });
  const valid =
    lines.length > 0 &&
    lines.every((l) => l.dose.trim() && l.frequency.trim() && Number(l.qtyPrescribed) > 0);
  const update = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="rx-search">Find a medicine (brand, ingredient or code)</Label>
        <Input
          id="rx-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="e.g. paracetamol"
        />
        {results.isFetching && <Spinner label="Searching…" />}
        {results.data && results.data.items.length === 0 && (
          <p className="text-sm text-slate-600">No medicines match.</p>
        )}
        {results.data && results.data.items.length > 0 && (
          <ul className="max-h-56 divide-y divide-slate-200 overflow-y-auto rounded-md border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
            {results.data.items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  disabled={lines.some((l) => l.medicineProductId === item.id)}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-50 dark:hover:bg-slate-800"
                  onClick={() =>
                    setLines((ls) => [
                      ...ls,
                      {
                        medicineProductId: item.id,
                        name: item.name,
                        available: item.totalAvailable,
                        dose: '',
                        frequency: '',
                        route: item.medicine?.route ?? 'oral',
                        durationDays: '',
                        qtyPrescribed: '',
                        instructions: '',
                      },
                    ])
                  }
                >
                  <span className="font-medium">{item.name}</span>
                  <span className="block text-xs text-slate-500">
                    {ingredientsLabel(item)} · {item.totalAvailable} {item.baseUnit} in stock
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {lines.map((l, i) => (
        <fieldset
          key={l.medicineProductId}
          className="space-y-2 rounded-md border border-slate-200 p-3 dark:border-slate-700"
        >
          <legend className="px-1 text-sm font-medium">
            {l.name}{' '}
            <span className={l.available === 0 ? 'text-red-700' : 'text-slate-500'}>
              ({l.available} in stock)
            </span>
          </legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
            {(
              [
                ['dose', 'Dose', 'e.g. 500 mg'],
                ['frequency', 'Frequency', 'e.g. 1-0-1'],
                ['route', 'Route', ''],
                ['durationDays', 'Days', ''],
                ['qtyPrescribed', 'Quantity', ''],
              ] as const
            ).map(([k, label, ph]) => (
              <div key={k} className="space-y-1">
                <Label htmlFor={`rx-${i}-${k}`} className="text-xs">
                  {label}
                </Label>
                <Input
                  id={`rx-${i}-${k}`}
                  value={l[k]}
                  placeholder={ph}
                  inputMode={k === 'durationDays' || k === 'qtyPrescribed' ? 'numeric' : undefined}
                  onChange={(e) => update(i, { [k]: e.target.value })}
                />
              </div>
            ))}
            <div className="flex items-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
              >
                Remove
              </Button>
            </div>
          </div>
          <Input
            aria-label="Instructions"
            placeholder="Instructions (optional)"
            value={l.instructions}
            onChange={(e) => update(i, { instructions: e.target.value })}
          />
        </fieldset>
      ))}
      {lines.length > 0 && (
        <Input
          aria-label="Prescription notes"
          placeholder="Notes for the pharmacist (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      )}
      {submit.error && submit.code !== 'ALLERGY_CONFLICT' && (
        <Alert tone="error">{submit.error}</Alert>
      )}
      <Button
        disabled={!valid || submit.pending}
        onClick={() =>
          submit.runAsync(body(false)).catch(() => {
            /* handled below */
          })
        }
      >
        {submit.pending ? 'Issuing…' : 'Issue prescription'}
      </Button>
      <ConfirmDialog
        open={submit.code === 'ALLERGY_CONFLICT' || askAllergy}
        onOpenChange={(o) => {
          if (!o) {
            setAskAllergy(false);
            submit.reset();
          }
        }}
        title="Allergy warning"
        description={submit.error ?? ''}
        confirmLabel="Prescribe anyway"
        pending={submit.pending}
        error={askAllergy && submit.code !== 'ALLERGY_CONFLICT' ? submit.error : null}
        onConfirm={() => {
          setAskAllergy(true);
          submit.run(body(true));
        }}
      >
        <p className="text-sm">The decision is yours and will be recorded in the audit log.</p>
      </ConfirmDialog>
    </div>
  );
}
