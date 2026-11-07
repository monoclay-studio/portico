import { Tabs as TabsPrimitive } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface TabItem {
  value: string;
  label: ReactNode;
  /** Count badge (e.g. arrivals remaining). */
  count?: number;
  content: ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  items: readonly TabItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  'aria-label': string;
  className?: string;
}

/** Tabs with automatic activation; arrow keys move (mirrored in RTL), Home/End jump. */
export function Tabs({ items, value, defaultValue, onValueChange, className, ...aria }: TabsProps) {
  return (
    <TabsPrimitive.Root
      {...(value !== undefined ? { value } : {})}
      defaultValue={defaultValue ?? items[0]?.value}
      {...(onValueChange ? { onValueChange } : {})}
      className={cn('flex flex-col gap-3', className)}
    >
      <TabsPrimitive.List
        aria-label={aria['aria-label']}
        className="flex gap-1 overflow-x-auto border-b border-line"
      >
        {items.map((t) => (
          <TabsPrimitive.Trigger
            key={t.value}
            value={t.value}
            disabled={t.disabled ?? false}
            data-focus-inset
            className="relative -mb-px inline-flex min-h-control items-center gap-2 whitespace-nowrap border-b-2 border-transparent px-3 text-sm font-medium text-ink-muted hover:text-ink data-[state=active]:border-accent data-[state=active]:text-ink"
          >
            {t.label}
            {t.count !== undefined && (
              <span className="pt-tabular rounded-full bg-surface-hover px-1.5 text-xs text-ink">
                {t.count}
              </span>
            )}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {items.map((t) => (
        <TabsPrimitive.Content key={t.value} value={t.value} className="min-h-0">
          {t.content}
        </TabsPrimitive.Content>
      ))}
    </TabsPrimitive.Root>
  );
}
