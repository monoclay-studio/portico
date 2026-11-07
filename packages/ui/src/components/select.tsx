import { Check, ChevronDown } from 'lucide-react';
import { Select as SelectPrimitive } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { fieldControlProps, useField } from './field';
import { controlClass } from './input';

export interface SelectOption {
  value: string;
  label: ReactNode;
  /** Plain-text label for type-ahead when `label` is not a string. */
  textValue?: string;
  disabled?: boolean;
  description?: ReactNode;
}

export interface SelectProps {
  value?: string | undefined;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  options: readonly SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  /** Accessible name when not inside <Field>. */
  'aria-label'?: string;
  className?: string;
  name?: string;
  id?: string;
}

/** Single choice from a short list (listbox popup with type-ahead). Use Combobox for long or searchable lists. */
export function Select({
  value,
  defaultValue,
  onValueChange,
  options,
  placeholder,
  disabled,
  className,
  name,
  id,
  ...aria
}: SelectProps) {
  const field = useField();
  return (
    <SelectPrimitive.Root
      {...(value !== undefined ? { value } : {})}
      {...(defaultValue !== undefined ? { defaultValue } : {})}
      {...(onValueChange ? { onValueChange } : {})}
      {...(disabled !== undefined ? { disabled } : {})}
      {...(name ? { name } : {})}
    >
      <SelectPrimitive.Trigger
        className={cn(controlClass, 'inline-flex items-center justify-between gap-2 text-start', className)}
        aria-label={aria['aria-label']}
        {...fieldControlProps(field, { id })}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon>
          <ChevronDown aria-hidden className="size-4 text-ink-muted" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className="z-50 max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) overflow-hidden rounded-md border border-line bg-surface shadow-lg"
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((o) => (
              <SelectPrimitive.Item
                key={o.value}
                value={o.value}
                disabled={o.disabled ?? false}
                {...(o.textValue ? { textValue: o.textValue } : {})}
                className="relative flex min-h-control cursor-default select-none items-center gap-2 rounded-sm ps-8 pe-3 text-sm text-ink outline-none data-disabled:opacity-50 data-highlighted:bg-accent-soft"
              >
                <SelectPrimitive.ItemIndicator className="absolute start-2 inline-flex">
                  <Check aria-hidden className="size-4 text-accent" />
                </SelectPrimitive.ItemIndicator>
                <div className="flex flex-col py-1">
                  <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                  {o.description && <span className="text-xs text-ink-muted">{o.description}</span>}
                </div>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
