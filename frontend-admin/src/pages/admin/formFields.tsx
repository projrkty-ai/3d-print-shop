import type { InputHTMLAttributes, ReactNode } from 'react';

/** Number input that keeps NaN while the field is empty so validation can flag it. */
export function NumberInput({
  value,
  onChange,
  ...rest
}: { value: number; onChange: (value: number) => void } & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'type'
>) {
  return (
    <input
      type="number"
      value={Number.isNaN(value) ? '' : value}
      onChange={(e) => onChange(e.target.valueAsNumber)}
      {...rest}
    />
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="field__help">{hint}</small>}
    </label>
  );
}
