import { VITAL_LIMITS, type VitalKey } from '@hospitalos/shared';
import { useState } from 'react';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Select } from '../../components/ui/select';
import { useAction } from '../../lib/use-api';

export type TempUnit = 'F' | 'C';

const FIELDS: [VitalKey, string, string][] = [
  ['tempC', 'Temperature', '0.1'],
  ['pulse', 'Pulse /min', '1'],
  ['bpSys', 'BP systolic', '1'],
  ['bpDia', 'BP diastolic', '1'],
  ['respRate', 'Resp /min', '1'],
  ['spo2', 'SpO₂ %', '1'],
  ['weightKg', 'Weight kg', '0.1'],
  ['heightCm', 'Height cm', '0.1'],
];

export const toCelsius = (f: number) => Math.round(((f - 32) * 5 * 10) / 9) / 10;
export const toFahrenheit = (c: number) => Math.round((c * 9 * 10) / 5 + 320) / 10;

/**
 * Checks the typed readings against the accepted ranges and builds the body to send
 * (temperature always in °C). Returns a message per field that needs fixing.
 */
export function checkVitals(
  values: Partial<Record<VitalKey, string>>,
  tempUnit: TempUnit,
): { body: Partial<Record<VitalKey, number>>; errors: Partial<Record<VitalKey, string>> } {
  const body: Partial<Record<VitalKey, number>> = {};
  const errors: Partial<Record<VitalKey, string>> = {};
  for (const [key] of FIELDS) {
    const raw = values[key]?.trim() ?? '';
    if (raw === '') continue;
    const n = Number(raw);
    const l = VITAL_LIMITS[key];
    if (key === 'tempC') {
      const [min, max, unit] =
        tempUnit === 'F' ? [toFahrenheit(l.min), toFahrenheit(l.max), '°F'] : [l.min, l.max, '°C'];
      if (!Number.isFinite(n) || n < min || n > max) {
        errors[key] = `Temperature must be ${min}–${max} ${unit}`;
        continue;
      }
      body[key] = tempUnit === 'F' ? toCelsius(n) : n;
      continue;
    }
    if (!Number.isFinite(n) || n < l.min || n > l.max) {
      errors[key] = `${l.label} must be ${l.min}–${l.max} ${l.unit}`;
    } else if (l.whole && !Number.isInteger(n)) {
      errors[key] = `${l.label} must be a whole number`;
    } else {
      body[key] = n;
    }
  }
  if ((body.bpSys === undefined) !== (body.bpDia === undefined) && !errors.bpSys && !errors.bpDia) {
    errors[body.bpSys === undefined ? 'bpSys' : 'bpDia'] = 'Enter both blood pressure values';
  }
  return { body, errors };
}

function withoutKey<T extends object>(o: T, key: keyof T): T {
  const copy = { ...o };
  delete copy[key];
  return copy;
}

/** Records one set of readings for a visit. Blank boxes are simply not recorded. */
export function VitalsForm({
  appointmentId,
  onSaved,
}: {
  appointmentId: string;
  onSaved?(): void;
}) {
  const [values, setValues] = useState<Partial<Record<VitalKey, string>>>({});
  const [tempUnit, setTempUnit] = useState<TempUnit>('F');
  const [errors, setErrors] = useState<Partial<Record<VitalKey, string>>>({});
  const save = useAction<Partial<Record<VitalKey, number>>>(
    'POST',
    `/api/appointments/${appointmentId}/vitals`,
    {
      invalidate: ['/api/encounters', '/api/patients', '/api/appointments'],
      onSuccess: () => {
        setValues({});
        setErrors({});
        onSaved?.();
      },
    },
  );
  return (
    <form
      className="space-y-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const checked = checkVitals(values, tempUnit);
        setErrors(checked.errors);
        if (Object.keys(checked.errors).length === 0) save.run(checked.body);
      }}
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {FIELDS.map(([key, label, step]) => (
          <div key={key} className="space-y-1">
            <Label htmlFor={`v-${key}`} className="text-xs">
              {label}
              {key === 'tempC' && ` °${tempUnit}`}
            </Label>
            <div className="flex gap-1">
              <Input
                id={`v-${key}`}
                type="number"
                step={step}
                inputMode="decimal"
                aria-invalid={errors[key] ? true : undefined}
                aria-describedby={errors[key] ? `v-${key}-error` : undefined}
                value={values[key] ?? ''}
                onChange={(e) => {
                  setValues((v) => ({ ...v, [key]: e.target.value }));
                  setErrors((er) => withoutKey(er, key));
                }}
              />
              {key === 'tempC' && (
                <Select
                  aria-label="Temperature unit"
                  className="w-20"
                  value={tempUnit}
                  onChange={(e) => {
                    setTempUnit(e.target.value as TempUnit);
                    setErrors((er) => withoutKey(er, 'tempC'));
                  }}
                >
                  <option value="F">°F</option>
                  <option value="C">°C</option>
                </Select>
              )}
            </div>
            {errors[key] && (
              <p id={`v-${key}-error`} className="text-xs text-red-700 dark:text-red-300">
                {errors[key]}
              </p>
            )}
          </div>
        ))}
      </div>
      {save.error && <Alert tone="error">{save.error}</Alert>}
      <Button
        type="submit"
        size="sm"
        disabled={save.pending || Object.values(values).every((v) => !v?.trim())}
      >
        {save.pending ? 'Saving…' : 'Record vitals'}
      </Button>
    </form>
  );
}
