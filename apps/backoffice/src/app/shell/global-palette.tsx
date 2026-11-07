import { CommandPalette, type PaletteCommand, ProvenanceBadge } from '@portico/ui';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { CircleHelp, Hotel, Languages, LogOut, Moon, UserRound } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { queries } from '../../api/queries';
import { workspaceSource } from '../../data/sources';
import { LOCALES, setLocale } from '../../i18n';
import { useApp } from '../app-context';
import { effectiveTheme, setTheme, useTheme } from '../theme';
import { NAV_ICONS } from './nav-icons';

/**
 * Global command palette + search shell. Navigation, property switching and actions are real; guest/booking
 * results come from the simulated workspace source until the reservations module merges, and are badged
 * SIMULATED in the list itself.
 */
export function GlobalPalette({ open, onOpenChange, onSignOut }: { open: boolean; onOpenChange: (o: boolean) => void; onSignOut: () => void }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { workspaces, properties, setPropertyId, property, session, openShortcuts } = useApp();
  const theme = useTheme();
  const simProperty = property
    ? { id: property.id, code: property.code, name: property.name, profile: property.profile, businessDate: property.businessDate, timezone: property.timezone, baseCurrency: property.baseCurrency }
    : null;
  const arrivals = useQuery({
    queryKey: ['sim', property?.id, property?.businessDate, 'arrivals'],
    queryFn: () => workspaceSource.arrivals(simProperty as NonNullable<typeof simProperty>),
    enabled: open && Boolean(simProperty),
  });
  const users = useQuery({ ...queries.users(session.organization.id), enabled: open, retry: false });

  const commands = useMemo<PaletteCommand[]>(() => {
    const list: PaletteCommand[] = [];
    for (const w of workspaces) {
      for (const item of w.items) {
        const Icon = NAV_ICONS[item.to];
        list.push({
          id: `nav:${item.to}`,
          group: t('commands.goTo'),
          label: t(item.labelKey),
          description: t(w.labelKey),
          icon: <Icon />,
          ...(item.shortcut ? { shortcut: item.shortcut } : {}),
          onSelect: () => void navigate({ to: item.to }),
        });
      }
    }
    for (const p of properties) {
      list.push({
        id: `property:${p.id}`,
        group: t('commands.properties'),
        label: p.name,
        description: `${p.code} · ${t(`profiles.${p.profile}`)} · ${t('app.businessDate')} ${p.businessDate}`,
        keywords: [p.code, 'property', 'switch'],
        icon: <Hotel />,
        onSelect: () => setPropertyId(p.id),
      });
    }
    for (const a of arrivals.data?.data ?? []) {
      list.push({
        id: `stay:${a.stayId}`,
        group: t('commands.recent'),
        label: `${a.guestName} — ${a.bookingCode}`,
        description: `${t('nav.arrivals')} · ${a.unitName ?? a.unitTypeName}`,
        keywords: [a.bookingCode, a.unitName ?? '', 'guest', 'booking'],
        badge: <ProvenanceBadge provenance="simulated" compact />,
        icon: <UserRound />,
        onSelect: () => void navigate({ to: '/front-desk/arrivals', search: { stay: a.stayId } }),
      });
    }
    for (const u of users.data ?? []) {
      list.push({
        id: `user:${u.userId}`,
        group: t('commands.recent'),
        label: u.displayName,
        description: `${t('nav.users')} · ${u.email}`,
        keywords: [u.email, 'staff', 'user'],
        icon: <UserRound />,
        onSelect: () => void navigate({ to: '/admin/users' }),
      });
    }
    list.push(
      {
        id: 'action:theme',
        group: t('commands.actions'),
        label: t('commands.toggleTheme'),
        icon: <Moon />,
        onSelect: () => setTheme(effectiveTheme(theme) === 'dark' ? 'light' : 'dark'),
      },
      ...LOCALES.filter((l) => l.code !== i18n.resolvedLanguage).map((l) => ({
        id: `action:locale:${l.code}`,
        group: t('commands.actions'),
        label: t('commands.switchLanguage', { language: l.label }),
        keywords: ['language', 'rtl', l.code],
        icon: <Languages />,
        onSelect: () => void setLocale(l.code),
      })),
      { id: 'action:shortcuts', group: t('commands.actions'), label: t('commands.showShortcuts'), shortcut: '?', icon: <CircleHelp />, onSelect: openShortcuts },
      { id: 'action:signout', group: t('commands.actions'), label: t('commands.signOut'), icon: <LogOut />, onSelect: onSignOut },
    );
    return list;
  }, [workspaces, properties, arrivals.data, users.data, t, navigate, setPropertyId, theme, i18n.resolvedLanguage, openShortcuts, onSignOut]);

  return (
    <CommandPalette
      open={open}
      onOpenChange={onOpenChange}
      commands={commands}
      placeholder={t('app.searchPlaceholder')}
      loading={arrivals.isFetching}
      footer={<ProvenanceBadge provenance="simulated" compact />}
    />
  );
}
