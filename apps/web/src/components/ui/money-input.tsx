import { useState } from 'react';
import { Input } from './input';

/** Rupees in the box, integer paise out (null while empty or invalid). */
export function MoneyInput({
  id,
  valuePaise,
  onChange,
  ...rest
}: {
  id?: string;
  valuePaise: number | null;
  onChange(paise: number | null): void;
  required?: boolean;
  'aria-invalid'?: boolean;
}) {
  const [text, setText] = useState(valuePaise === null ? '' : (valuePaise / 100).toFixed(2));
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-slate-500">
        ₹
      </span>
      <Input
        id={id}
        inputMode="decimal"
        className="pl-7"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const v = e.target.value.trim();
          onChange(/^\d+(\.\d{1,2})?$/.test(v) ? Math.round(Number(v) * 100) : null);
        }}
        {...rest}
      />
    </div>
  );
}
