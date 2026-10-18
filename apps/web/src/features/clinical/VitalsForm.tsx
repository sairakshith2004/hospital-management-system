import { useState } from 'react';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { useAction } from '../../lib/use-api';

const FIELDS = [
  ['tempC', 'Temp °C', '0.1'],
  ['pulse', 'Pulse /min', '1'],
  ['bpSys', 'BP systolic', '1'],
  ['bpDia', 'BP diastolic', '1'],
  ['respRate', 'Resp /min', '1'],
  ['spo2', 'SpO₂ %', '1'],
  ['weightKg', 'Weight kg', '0.1'],
  ['heightCm', 'Height cm', '0.1'],
] as const;

/** Records one set of readings for a visit. Blank boxes are simply not recorded. */
export function VitalsForm({
  appointmentId,
  onSaved,
}: {
  appointmentId: string;
  onSaved?(): void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const save = useAction<Record<string, number>>(
    'POST',
    `/api/appointments/${appointmentId}/vitals`,
    {
      invalidate: ['/api/encounters', '/api/patients', '/api/appointments'],
      onSuccess: () => {
        setValues({});
        onSaved?.();
      },
    },
  );
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const body: Record<string, number> = {};
        for (const [k, v] of Object.entries(values)) if (v.trim() !== '') body[k] = Number(v);
        save.run(body);
      }}
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {FIELDS.map(([key, label, step]) => (
          <div key={key} className="space-y-1">
            <Label htmlFor={`v-${key}`} className="text-xs">
              {label}
            </Label>
            <Input
              id={`v-${key}`}
              type="number"
              step={step}
              inputMode="decimal"
              value={values[key] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
            />
          </div>
        ))}
      </div>
      {save.error && <Alert tone="error">{save.error}</Alert>}
      <Button
        type="submit"
        size="sm"
        disabled={save.pending || Object.values(values).every((v) => !v.trim())}
      >
        {save.pending ? 'Saving…' : 'Record vitals'}
      </Button>
    </form>
  );
}
