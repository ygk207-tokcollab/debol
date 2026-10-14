import { forwardRef } from 'react';
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface FieldShell {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  className?: string;
}

function wrapper(error?: string | null, extra?: string) {
  return `mt-1 ${extra ?? ''} ${error ? 'field-error' : ''}`.trim();
}

export const TextField = forwardRef<HTMLInputElement, FieldShell & InputHTMLAttributes<HTMLInputElement>>(
  ({ label, hint, error, required, className, id, ...input }, ref) => {
    const { t } = useTranslation();
    const fieldId = id ?? `f-${String(input.name ?? label).replace(/\W+/g, '-').toLowerCase()}`;
    return (
      <div className={className}>
        <label className="field-label" htmlFor={fieldId}>
          {label}
          {!required && <span className="ml-1 text-xs font-normal text-ink-mute">({t('common.optional')})</span>}
        </label>
        <input
          ref={ref}
          id={fieldId}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${fieldId}-error` : undefined}
          className={wrapper(error, 'field')}
          {...input}
        />
        {hint && !error && <p className="mt-1 text-xs text-ink-mute">{hint}</p>}
        {error && (
          <p id={`${fieldId}-error`} className="mt-1 flex items-center gap-1 text-xs text-error-600">
            <AlertCircle className="size-3.5 shrink-0" aria-hidden />
            {error}
          </p>
        )}
      </div>
    );
  },
);
TextField.displayName = 'TextField';

export const TextAreaField = forwardRef<HTMLTextAreaElement, FieldShell & TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ label, hint, error, required, className, id, rows = 3, ...input }, ref) => {
    const { t } = useTranslation();
    const fieldId = id ?? `f-${String(input.name ?? label).replace(/\W+/g, '-').toLowerCase()}`;
    return (
      <div className={className}>
        <label className="field-label" htmlFor={fieldId}>
          {label}
          {!required && <span className="ml-1 text-xs font-normal text-ink-mute">({t('common.optional')})</span>}
        </label>
        <textarea
          ref={ref}
          id={fieldId}
          rows={rows}
          aria-invalid={Boolean(error)}
          className={wrapper(error, 'field')}
          {...input}
        />
        {hint && !error && <p className="mt-1 text-xs text-ink-mute">{hint}</p>}
        {error && <p className="mt-1 text-xs text-error-600">{error}</p>}
      </div>
    );
  },
);
TextAreaField.displayName = 'TextAreaField';

interface SelectProps extends FieldShell, SelectHTMLAttributes<HTMLSelectElement> {
  options: { value: string; label: string }[];
  placeholder?: string;
}

export function SelectField({ label, hint, error, required, className, id, options, placeholder, ...select }: SelectProps) {
  const fieldId = id ?? `f-${String(select.name ?? label).replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div className={className}>
      <label className="field-label" htmlFor={fieldId}>
        {label}
      </label>
      <select id={fieldId} aria-invalid={Boolean(error)} className={wrapper(error, 'field')} {...select}>
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint && !error && <p className="mt-1 text-xs text-ink-mute">{hint}</p>}
      {error && <p className="mt-1 text-xs text-error-600">{error}</p>}
    </div>
  );
}

export function ToggleField({
  label, checked, onChange, hint, disabled,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-start gap-3 py-1 ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        className="mt-0.5 size-4 accent-primary-500"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        <span className="block text-sm font-medium text-ink">{label}</span>
        {hint && <span className="block text-xs text-ink-mute">{hint}</span>}
      </span>
    </label>
  );
}

export function SectionCard({
  title, description, actions, children, className = '',
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card px-4 py-4 sm:px-5 ${className}`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-lg leading-tight text-ink">{title}</h2>
          {description && <p className="mt-1 text-sm text-ink-soft">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function KeyValue({ label, value, mono }: { label: ReactNode; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-surface-200 py-2 last:border-0">
      <dt className="text-sm text-ink-mute">{label}</dt>
      <dd className={`text-right text-sm text-ink ${mono ? 'tabular-nums' : ''}`}>{value}</dd>
    </div>
  );
}
