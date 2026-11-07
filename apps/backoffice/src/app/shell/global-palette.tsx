import { CommandPalette, type PaletteCommand, ProvenanceBadge } from '@portico/ui';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  CircleHelp,
  Clock,
  GraduationCap,
  Hotel,
  Languages,
  LogOut,
  Moon,
  Pin,
  Rows3,
  Search,
  UserRound,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api';
import { scopeKey } from '../../api/queries';
import { workspaceSource } from '../../data/sources';
import { toSimProperty } from '../../features/common/sim-property';
import { LOCALES, setLocale } from '../../i18n';
import { learning } from '../../learning/progress';
import { definitionFor } from '../../records/registry';
import { pinnedRecords, recentRecords, useRecordRefs } from '../../records/stores';
import { useRecordNav } from '../../records/use-record-nav';
import { useApp } from '../app-context';
import { effectiveTheme, setTheme, useTheme } from '../theme';
import { NAV_ICONS } from './nav-icons';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/**
 * Global search (/) and command palette (Ctrl/⌘K): one surface. Records come from GET /v1/search (real,
 * permission-aware, every module's provider as they merge) plus simulated stays until reservations merges
 * (badged SIMULATED); navigation and actions come from the app registry; recent and pinned records first.
 */
export function GlobalPalette({
  open,
  mode,
  onOpenChange,
  onSignOut,
  onShortcuts,
  onDensity,
}: {
  open: boolean;
  mode: 'search' | 'command';
  onOpenChange: (o: boolean) => void;
  onSignOut: () => void;
  onShortcuts: () => void;
  onDensity: () => void;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const app = useApp();
  const { workspaces, properties, setPropertyId, property, me } = app;
  const nav = useRecordNav();
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim(), 150);
  const recent = useRecordRefs(recentRecords, me.userId);
  const pinned = useRecordRefs(pinnedRecords, me.userId);

  useEffect(() => {
    if (open) {
      setQuery('');
      learning.event('palette:open');
    }
  }, [open]);

  const server = useQuery({
    queryKey: scopeKey(app.session, 'search', q),
    queryFn: ({ signal }) => api.search(q, { limit: 12, signal }),
    enabled: open && q.length >= 2,
    staleTime: 10_000,
    retry: false,
  });
  const sim = useQuery({
    queryKey: ['sim', property?.id, property?.businessDate, 'arrivals'],
    queryFn: () => workspaceSource.arrivals(toSimProperty(property as NonNullable<typeof property>)),
    enabled: open && Boolean(property),
  });

  const openRecord = (type: string, id: string) => {
    if (definitionFor(type)) nav.openFresh(type, id);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: openRecord closes over the record trail, which is read fresh on select
  const commands = useMemo<PaletteCommand[]>(() => {
    const list: PaletteCommand[] = [];
    const typeLabel = (type: string) => t(`records.types.${type}`, { defaultValue: type });
    if (!q) {
      for (const p of pinned)
        list.push({
          id: `pin:${p.type}:${p.id}`,
          group: t('nav.pinned'),
          label: p.title,
          description: typeLabel(p.type),
          icon: <Pin />,
          onSelect: () => openRecord(p.type, p.id),
        });
      for (const r of recent.filter((r) => !pinned.some((p) => p.type === r.type && p.id === r.id)))
        list.push({
          id: `recent:${r.type}:${r.id}`,
          group: t('nav.recent'),
          label: r.title,
          description: typeLabel(r.type),
          icon: <Clock />,
          onSelect: () => openRecord(r.type, r.id),
        });
    }
    for (const h of server.data?.data.items ?? []) {
      list.push({
        id: `hit:${h.type}:${h.id}`,
        group: t('commands.recent'),
        label: h.title,
        description: `${h.label ?? typeLabel(h.type)}${h.subtitle ? ` · ${h.subtitle}` : ''}`,
        keywords: [q],
        icon: h.type === 'property' ? <Hotel /> : <Search />,
        onSelect: () => openRecord(h.type, h.id),
      });
    }
    if (q) {
      for (const a of sim.data?.data ?? []) {
        list.push({
          id: `stay:${a.stayId}`,
          group: t('commands.recent'),
          label: `${a.guestName} — ${a.bookingCode}`,
          description: `${t('records.types.stay')} · ${a.unitName ?? a.unitTypeName}`,
          keywords: [a.bookingCode, a.unitName ?? '', a.unitTypeName],
          badge: <ProvenanceBadge provenance="simulated" compact />,
          icon: <UserRound />,
          onSelect: () => openRecord('stay', a.stayId),
        });
      }
    }
    if (mode === 'command' || q) {
      for (const w of workspaces) {
        for (const item of w.items) {
          const Icon = NAV_ICONS[item.to];
          list.push({
            id: `nav:${item.to}`,
            group: t('commands.goTo'),
            label: t(item.labelKey),
            description: t(w.labelKey),
            icon: <Icon />,
            ...(item.goKey ? { shortcut: `G ${item.goKey.toUpperCase()}` } : {}),
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
      list.push(
        {
          id: 'action:theme',
          group: t('commands.actions'),
          label: t('commands.toggleTheme'),
          icon: <Moon />,
          onSelect: () => setTheme(effectiveTheme(theme) === 'dark' ? 'light' : 'dark'),
        },
        {
          id: 'action:density',
          group: t('commands.actions'),
          label: t('commands.toggleDensity'),
          icon: <Rows3 />,
          onSelect: onDensity,
        },
        ...LOCALES.filter((l) => l.code !== i18n.resolvedLanguage).map((l) => ({
          id: `action:locale:${l.code}`,
          group: t('commands.actions'),
          label: t('commands.switchLanguage', { language: l.label }),
          keywords: ['language', 'rtl', l.code],
          icon: <Languages />,
          onSelect: () => void setLocale(l.code),
        })),
        {
          id: 'action:learn',
          group: t('commands.actions'),
          label: t('learn.practise'),
          icon: <GraduationCap />,
          onSelect: () => void navigate({ to: '/learn' }),
        },
        {
          id: 'action:shortcuts',
          group: t('commands.actions'),
          label: t('commands.showShortcuts'),
          shortcut: '?',
          icon: <CircleHelp />,
          onSelect: onShortcuts,
        },
        {
          id: 'action:signout',
          group: t('commands.actions'),
          label: t('commands.signOut'),
          icon: <LogOut />,
          onSelect: onSignOut,
        },
      );
    }
    return list;
  }, [
    q,
    mode,
    pinned,
    recent,
    server.data,
    sim.data,
    workspaces,
    properties,
    t,
    navigate,
    setPropertyId,
    theme,
    i18n.resolvedLanguage,
    onShortcuts,
    onSignOut,
    onDensity,
  ]);

  return (
    <CommandPalette
      open={open}
      onOpenChange={onOpenChange}
      commands={commands}
      onQueryChange={setQuery}
      placeholder={mode === 'search' ? t('app.searchPlaceholder') : t('app.commandPlaceholder')}
      loading={server.isFetching}
      footer={
        <span className="inline-flex items-center gap-2">
          <span className="pt-data">{t('commands.searchSource')}</span>
          <ProvenanceBadge provenance="simulated" compact />
        </span>
      }
    />
  );
}
