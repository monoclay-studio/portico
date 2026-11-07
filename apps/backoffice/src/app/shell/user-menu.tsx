import { IconButton } from '@portico/ui';
import { Link } from '@tanstack/react-router';
import {
  Check,
  CircleHelp,
  GraduationCap,
  Languages,
  LogOut,
  Monitor,
  Moon,
  Rows3,
  Rows4,
  Sun,
  UserRound,
} from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { useTranslation } from 'react-i18next';
import { LOCALES, type LocaleCode, setLocale } from '../../i18n';
import { useApp } from '../app-context';
import { type Density, density as densityStore, useDensity } from '../density';
import { setTheme, type ThemeChoice, useTheme } from '../theme';

const itemClass =
  'relative flex min-h-control cursor-default items-center gap-2 rounded-sm ps-8 pe-3 text-sm outline-none data-highlighted:bg-accent-soft';

export function UserMenu({ onSignOut }: { onSignOut: () => void }) {
  const { t, i18n } = useTranslation();
  const { me, organization, openShortcuts } = useApp();
  const theme = useTheme();
  const density = useDensity();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <IconButton label={`${t('app.account')}: ${me.displayName}`} icon={<UserRound />} variant="ghost" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-64 rounded-md border border-line bg-surface p-1 shadow-lg"
        >
          <div className="px-3 py-2">
            <p className="text-sm font-semibold">{me.displayName}</p>
            <p className="text-xs text-ink-muted">{me.email}</p>
            <p className="mt-1 text-xs text-ink-muted">
              {organization.name} · {[...new Set(me.roles.map((r) => r.name))].join(', ')}
            </p>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Label className="px-3 py-1 text-xs font-semibold text-ink-muted">
            {t('app.theme')}
          </DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={theme} onValueChange={(v) => setTheme(v as ThemeChoice)}>
            {(
              [
                ['light', t('app.themeLight'), Sun],
                ['dark', t('app.themeDark'), Moon],
                ['system', t('app.themeSystem'), Monitor],
              ] as const
            ).map(([value, label, Icon]) => (
              <DropdownMenu.RadioItem key={value} value={value} className={itemClass}>
                <DropdownMenu.ItemIndicator className="absolute start-2">
                  <Check aria-hidden className="size-4 text-accent" />
                </DropdownMenu.ItemIndicator>
                <Icon aria-hidden className="size-4 text-ink-muted" />
                {label}
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Label className="px-3 py-1 text-xs font-semibold text-ink-muted">
            {t('app.density')}
          </DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={density} onValueChange={(v) => densityStore.set(v as Density)}>
            {(
              [
                ['compact', t('app.densityCompact'), Rows4],
                ['comfortable', t('app.densityComfortable'), Rows3],
              ] as const
            ).map(([value, label, Icon]) => (
              <DropdownMenu.RadioItem key={value} value={value} className={itemClass}>
                <DropdownMenu.ItemIndicator className="absolute start-2">
                  <Check aria-hidden className="size-4 text-accent" />
                </DropdownMenu.ItemIndicator>
                <Icon aria-hidden className="size-4 text-ink-muted" />
                {label}
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Label className="px-3 py-1 text-xs font-semibold text-ink-muted">
            {t('app.language')}
          </DropdownMenu.Label>
          <DropdownMenu.RadioGroup
            value={i18n.resolvedLanguage ?? 'en'}
            onValueChange={(v) => void setLocale(v as LocaleCode)}
          >
            {LOCALES.map((l) => (
              <DropdownMenu.RadioItem
                key={l.code}
                value={l.code}
                className={itemClass}
                lang={l.code}
                dir={l.dir}
              >
                <DropdownMenu.ItemIndicator className="absolute start-2">
                  <Check aria-hidden className="size-4 text-accent" />
                </DropdownMenu.ItemIndicator>
                <Languages aria-hidden className="size-4 text-ink-muted" />
                {l.label}
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Item className={itemClass} asChild>
            <Link to="/learn">
              <GraduationCap aria-hidden className="absolute start-2 size-4 text-ink-muted" />
              {t('learn.practise')}
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item className={itemClass} onSelect={openShortcuts}>
            <CircleHelp aria-hidden className="absolute start-2 size-4 text-ink-muted" />
            {t('app.shortcuts')}
          </DropdownMenu.Item>
          <DropdownMenu.Item className={itemClass} onSelect={onSignOut}>
            <LogOut aria-hidden className="absolute start-2 size-4 text-ink-muted" />
            {t('app.signOut')}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
