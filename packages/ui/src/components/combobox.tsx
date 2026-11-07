import { Check, ChevronDown } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import { cn } from '../lib/cn';
import { useControllableState } from '../lib/hooks';
import { useUi } from '../provider';
import { fmt } from '../strings';
import { fieldControlProps, useField } from './field';
import { controlClass } from './input';

export interface ComboboxOption {
  value: string;
  label: string;
  description?: ReactNode;
  /** Extra words that should match the filter (codes, aliases). */
  keywords?: string[];
  disabled?: boolean;
}

export interface ComboboxProps {
  options: readonly ComboboxOption[];
  value?: string | null | undefined;
  defaultValue?: string | null;
  onValueChange?: (value: string | null) => void;
  /** Called as the user types (use for server-side search; pass the results back as `options`). */
  onInputChange?: (text: string) => void;
  placeholder?: string;
  disabled?: boolean;
  'aria-label'?: string;
  className?: string;
  id?: string;
  /** Disable client-side filtering when options come from a server search. */
  filter?: boolean;
  loading?: boolean;
}

export function defaultComboboxFilter(options: readonly ComboboxOption[], text: string): ComboboxOption[] {
  const q = text.trim().toLowerCase();
  if (!q) return [...options];
  const words = q.split(/\s+/);
  return options.filter((o) => {
    const hay = [o.label, ...(o.keywords ?? [])].join(' ').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/**
 * Editable combobox with list autocomplete (WAI-ARIA 1.2 combobox pattern). Type to filter, ↑/↓ to move,
 * Enter to choose, Esc to close (and again to clear), Alt+↓ to open without filtering.
 */
export function Combobox({
  options,
  value: valueProp,
  defaultValue = null,
  onValueChange,
  onInputChange,
  placeholder,
  disabled,
  className,
  id,
  filter = true,
  loading,
  ...aria
}: ComboboxProps) {
  const { strings } = useUi();
  const field = useField();
  const [value, setValue] = useControllableState<string | null>({
    value: valueProp,
    defaultValue,
    onChange: onValueChange,
  });
  const selected = options.find((o) => o.value === value) ?? null;
  const [text, setText] = useState(selected?.label ?? '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [typed, setTyped] = useState(false);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) setText(selected?.label ?? '');
  }, [selected?.label, open]);

  const visible = useMemo(
    () => (filter && typed ? defaultComboboxFilter(options, text) : [...options]),
    [filter, typed, options, text],
  );
  const activeOption = open ? visible[active] : undefined;

  const choose = (o: ComboboxOption | undefined) => {
    if (!o || o.disabled) return;
    setValue(o.value);
    setText(o.label);
    setOpen(false);
    setTyped(false);
  };

  const move = (delta: number) => {
    if (!open) {
      setOpen(true);
      return;
    }
    if (visible.length === 0) return;
    setActive((i) => (i + delta + visible.length) % visible.length);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (e.altKey) {
          setTyped(false);
          setOpen(true);
        } else move(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        move(-1);
        break;
      case 'Enter':
        if (open && activeOption) {
          e.preventDefault();
          choose(activeOption);
        }
        break;
      case 'Escape':
        if (open) {
          e.preventDefault();
          setOpen(false);
          setText(selected?.label ?? '');
          setTyped(false);
        } else if (text) {
          e.preventDefault();
          setText('');
          setValue(null);
        }
        break;
      case 'Home':
        if (open) {
          e.preventDefault();
          setActive(0);
        }
        break;
      case 'End':
        if (open) {
          e.preventDefault();
          setActive(Math.max(0, visible.length - 1));
        }
        break;
    }
  };

  return (
    <div className={cn('relative', className)}>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeOption ? `${listId}-${activeOption.value}` : undefined}
        aria-label={aria['aria-label']}
        aria-busy={loading || undefined}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        placeholder={placeholder}
        value={text}
        className={cn(controlClass, 'pe-9')}
        {...fieldControlProps(field, { id })}
        onChange={(e) => {
          setText(e.target.value);
          setTyped(true);
          setOpen(true);
          setActive(0);
          onInputChange?.(e.target.value);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          // Let option clicks land first.
          setTimeout(() => setOpen(false), 120);
        }}
        onClick={() => !disabled && setOpen(true)}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={strings.combobox.showOptions}
        disabled={disabled}
        className="absolute inset-y-0 end-0 flex w-9 items-center justify-center text-ink-muted"
        onClick={() => {
          setTyped(false);
          setOpen((o) => !o);
          inputRef.current?.focus();
        }}
      >
        <ChevronDown aria-hidden className="size-4" />
      </button>
      <ul
        id={listId}
        role="listbox"
        aria-label={aria['aria-label']}
        hidden={!open}
        className="absolute inset-x-0 top-full z-40 mt-1 max-h-72 overflow-auto rounded-md border border-line bg-surface p-1 shadow-lg"
      >
        {visible.map((o, i) => (
          <li
            key={o.value}
            id={`${listId}-${o.value}`}
            role="option"
            aria-selected={o.value === value}
            aria-disabled={o.disabled || undefined}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setActive(i)}
            onClick={() => choose(o)}
            className={cn(
              'flex min-h-control cursor-default items-center gap-2 rounded-sm px-2 text-sm',
              i === active && 'bg-accent-soft',
              o.disabled && 'opacity-50',
            )}
          >
            <span className="inline-flex w-4 shrink-0">
              {o.value === value && <Check aria-hidden className="size-4 text-accent" />}
            </span>
            <span className="flex flex-col py-1">
              <span>{o.label}</span>
              {o.description && <span className="text-xs text-ink-muted">{o.description}</span>}
            </span>
          </li>
        ))}
        {visible.length === 0 && (
          <li role="presentation" className="px-3 py-2 text-sm text-ink-muted">
            {loading ? strings.common.loading : strings.combobox.noMatches}
          </li>
        )}
      </ul>
      <span className="pt-sr-only" aria-live="polite">
        {open && typed ? fmt(strings.combobox.results, { count: visible.length }) : ''}
      </span>
    </div>
  );
}
