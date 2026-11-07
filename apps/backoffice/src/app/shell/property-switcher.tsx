import { Button, cn } from '@portico/ui';
import { Check, ChevronsUpDown, Hotel } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { useTranslation } from 'react-i18next';
import { useApp } from '../app-context';

/** Property switcher (top bar). Properties come from GET /v1/properties; the choice is remembered per org. */
export function PropertySwitcher({
  open,
  onOpenChange,
}: {
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
}) {
  const { t } = useTranslation();
  const { properties, property, setPropertyId } = useApp();
  if (properties.length === 0) {
    return <span className="text-sm text-ink-muted">{t('app.noProperties')}</span>;
  }
  return (
    <DropdownMenu.Root {...(open !== undefined ? { open } : {})} {...(onOpenChange ? { onOpenChange } : {})}>
      <DropdownMenu.Trigger asChild>
        <Button
          variant="ghost"
          className="max-w-full justify-start gap-2 px-2"
          aria-label={`${t('app.switchProperty')}: ${property?.name ?? ''}`}
          data-testid="property-switcher"
        >
          <Hotel aria-hidden className="size-4 shrink-0 text-ink-muted" />
          <span className="flex min-w-0 flex-col items-start leading-tight">
            <span className="truncate text-sm font-semibold">{property?.name}</span>
            <span className="text-[0.6875rem] font-normal text-ink-muted">
              {property?.code} · {t('app.businessDate')} {property?.businessDate}
            </span>
          </span>
          <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-ink-muted" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className="z-50 min-w-72 max-w-[calc(100vw-2rem)] rounded-md border border-line bg-surface p-1 shadow-lg"
        >
          <DropdownMenu.Label className="px-2 py-1.5 text-xs font-semibold text-ink-muted">
            {t('app.switchProperty')}
          </DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={property?.id ?? ''} onValueChange={setPropertyId}>
            {properties.map((p) => (
              <DropdownMenu.RadioItem
                key={p.id}
                value={p.id}
                className={cn(
                  'relative flex min-h-control cursor-default flex-col items-start justify-center rounded-sm py-1.5 ps-8 pe-3 text-sm outline-none',
                  'data-highlighted:bg-accent-soft',
                )}
              >
                <DropdownMenu.ItemIndicator className="absolute start-2 top-1/2 -translate-y-1/2">
                  <Check aria-hidden className="size-4 text-accent" />
                </DropdownMenu.ItemIndicator>
                <span className="font-medium">{p.name}</span>
                <span className="text-xs text-ink-muted">
                  {p.code} · {t(`profiles.${p.profile}`)} · {p.timezone}
                </span>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
