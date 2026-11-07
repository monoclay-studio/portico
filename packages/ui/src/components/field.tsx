import { createContext, type ReactNode, useContext, useId } from 'react';
import { cn } from '../lib/cn';

interface FieldContextValue {
  id: string;
  descriptionId: string | undefined;
  errorId: string | undefined;
  invalid: boolean;
  required: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

/** Ids and state that a control inside <Field> uses for aria-describedby / aria-invalid. */
export function useField(): FieldContextValue | null {
  return useContext(FieldContext);
}

export function fieldControlProps(field: FieldContextValue | null, own: { id?: string | undefined } = {}) {
  if (!field) return { id: own.id };
  const describedBy = [field.descriptionId, field.errorId].filter(Boolean).join(' ') || undefined;
  return {
    id: own.id ?? field.id,
    'aria-describedby': describedBy,
    'aria-invalid': field.invalid || undefined,
    'aria-required': field.required || undefined,
  };
}

export interface FieldProps {
  label: ReactNode;
  children: ReactNode;
  description?: ReactNode;
  /** Error text: what is wrong AND how to fix it. Rendered with an icon, not colour alone. */
  error?: ReactNode;
  required?: boolean;
  /** Visually hide the label (still announced). */
  hideLabel?: boolean;
  className?: string;
  id?: string;
}

/** Label + control + description + error, wired together for assistive technology. */
export function Field({
  label,
  children,
  description,
  error,
  required,
  hideLabel,
  className,
  id,
}: FieldProps) {
  const auto = useId();
  const base = id ?? `f${auto}`;
  const value: FieldContextValue = {
    id: base,
    descriptionId: description ? `${base}-desc` : undefined,
    errorId: error ? `${base}-err` : undefined,
    invalid: Boolean(error),
    required: Boolean(required),
  };
  return (
    <FieldContext.Provider value={value}>
      <div className={cn('flex flex-col gap-1', className)}>
        <label
          htmlFor={base}
          className={cn('text-[0.8125rem] font-medium text-ink', hideLabel && 'pt-sr-only')}
        >
          {label}
          {required && (
            <span className="text-danger-fg" aria-hidden>
              {' '}
              *
            </span>
          )}
        </label>
        {children}
        {description && (
          <p id={value.descriptionId} className="text-xs text-ink-muted">
            {description}
          </p>
        )}
        {error && (
          <p id={value.errorId} className="flex items-start gap-1 text-xs font-medium text-danger-fg">
            <svg aria-hidden viewBox="0 0 16 16" className="mt-px size-3.5 shrink-0 fill-current">
              <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm-.75 3.5h1.5v4.5h-1.5V4.5Zm0 6h1.5V12h-1.5v-1.5Z" />
            </svg>
            <span>{error}</span>
          </p>
        )}
      </div>
    </FieldContext.Provider>
  );
}
