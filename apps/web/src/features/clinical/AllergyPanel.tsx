import { ALLERGY_SEVERITIES, type Allergy } from '@hospitalos/shared';
import { useState } from 'react';
import { Alert } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { useAction } from '../../lib/use-api';

/** Active allergies, always visible at the top of clinical screens. */
export function AllergyPanel({
  patientId,
  allergies,
  editable,
}: {
  patientId: string;
  allergies: Allergy[];
  editable: boolean;
}) {
  const active = allergies.filter((a) => a.status === 'active');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ substance: '', reaction: '', severity: 'unknown' });
  const add = useAction('POST', `/api/patients/${patientId}/allergies`, {
    invalidate: ['/api/patients', '/api/encounters'],
    onSuccess: () => {
      setForm({ substance: '', reaction: '', severity: 'unknown' });
      setAdding(false);
    },
  });
  const deactivate = useAction<{ id: string }>('POST', (b) => `/api/allergies/${b.id}/deactivate`, {
    invalidate: ['/api/patients'],
  });
  return (
    <div
      className={
        active.length
          ? 'rounded-lg border border-red-300 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950'
          : 'rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900'
      }
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">Allergies:</span>
        {active.length === 0 && <span>None recorded</span>}
        {active.map((a) => (
          <span key={a.id} className="inline-flex items-center gap-1">
            <Badge tone="danger">
              {a.substance}
              {a.reaction ? ` — ${a.reaction}` : ''} ({a.severity})
            </Badge>
            {editable && (
              <button
                type="button"
                className="text-xs text-slate-600 underline"
                onClick={() => deactivate.run({ id: a.id })}
              >
                mark inactive
              </button>
            )}
          </span>
        ))}
        {editable && !adding && (
          <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
            Add allergy
          </Button>
        )}
      </div>
      {adding && (
        <form
          className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_10rem_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            add.run(form);
          }}
        >
          <Input
            aria-label="Substance"
            placeholder="Substance, e.g. penicillin"
            value={form.substance}
            onChange={(e) => setForm({ ...form, substance: e.target.value })}
          />
          <Input
            aria-label="Reaction"
            placeholder="Reaction (optional)"
            value={form.reaction}
            onChange={(e) => setForm({ ...form, reaction: e.target.value })}
          />
          <Select
            aria-label="Severity"
            value={form.severity}
            onChange={(e) => setForm({ ...form, severity: e.target.value })}
          >
            {ALLERGY_SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
          <Button type="submit" disabled={!form.substance.trim() || add.pending}>
            Save
          </Button>
        </form>
      )}
      {(add.error ?? deactivate.error) && (
        <Alert tone="error" className="mt-2">
          {add.error ?? deactivate.error}
        </Alert>
      )}
    </div>
  );
}
