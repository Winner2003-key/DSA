'use client';

import { useState, type ReactNode } from 'react';

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <span className="field-label">{label}</span>
      {children}
      {hint && <p className="mt-1 text-[11px] text-ink-faint">{hint}</p>}
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  book,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Set text transcribed from the book in the serif. */
  book?: boolean;
  hint?: ReactNode;
}) {
  return (
    <Field label={label} hint={hint}>
      <input className={`field ${book ? 'book text-[14px]' : ''}`} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

export function TextArea({
  label,
  value,
  onChange,
  rows = 3,
  placeholder,
  book,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  book?: boolean;
}) {
  return (
    <Field label={label}>
      <textarea
        className={`field resize-y ${book ? 'book text-[14px]' : ''}`}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

export function NumberField({ label, value, onChange, hint }: { label: string; value: number | null; onChange: (value: number | null) => void; hint?: ReactNode }) {
  return (
    <Field label={label} hint={hint}>
      <input
        className="field tabular"
        type="number"
        min={1}
        value={value ?? ''}
        onChange={(e) => {
          const raw = e.target.value.trim();
          onChange(raw === '' ? null : Number.parseInt(raw, 10));
        }}
      />
    </Field>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  hint?: ReactNode;
}) {
  return (
    <Field label={label} hint={hint}>
      <select className="field" value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function ReadOnly({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Field label={label}>
      <div className="rounded-sm border border-rule bg-surface-sunk px-2 py-1.5 break-all text-ink-soft">{children}</div>
    </Field>
  );
}

/**
 * A list edited one entry per line, stored as a string array. The raw text is
 * kept locally so a trailing newline survives while typing; it is re-read from
 * `values` whenever they change from outside (undo, another selection).
 */
export function ListField({
  label,
  values,
  onChange,
  hint,
  commitOnBlur,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  hint?: ReactNode;
  /** For lists whose lines are parsed and may be dropped while half-typed. */
  commitOnBlur?: boolean;
}) {
  const joined = values.join('\n');
  const [text, setText] = useState(joined);
  const [synced, setSynced] = useState(joined);
  if (joined !== synced) {
    setSynced(joined);
    setText(joined);
  }
  const commit = (next: string) => {
    const parsed = next
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    setSynced(parsed.join('\n'));
    if (parsed.join('\n') !== joined) onChange(parsed);
  };
  return (
    <Field label={label} hint={hint}>
      <textarea
        className="field book resize-y text-[14px]"
        rows={2}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (!commitOnBlur) commit(e.target.value);
        }}
        onBlur={(e) => {
          if (commitOnBlur) commit(e.target.value);
        }}
      />
    </Field>
  );
}

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="border-t border-rule px-3 py-3 first:border-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold tracking-[0.02em] text-ink-soft">{title}</h3>
        {action}
      </div>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}
