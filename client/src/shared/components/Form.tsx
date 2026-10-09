import { ReactNode } from 'react';

export function Field({ label, children, span }: { label: string; children: ReactNode; span?: boolean }) {
  return (
    <label className={`field${span ? ' field-span' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

export function inputProps(value: string, onChange: (v: string) => void) {
  return {
    className: 'text-input',
    value,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value),
  };
}
