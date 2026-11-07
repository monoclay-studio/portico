import type { AppPath } from '../app/workspaces';

export type LessonKind = 'tour' | 'article' | 'video' | 'practice';

export interface Lesson {
  id: string;
  /** i18n key under learn.lessons */
  titleKey: string;
  helpKey: string;
  kind: LessonKind;
  minutes: number;
  /** Where in the product the lesson happens. */
  to?: AppPath;
}

export interface LearningPath {
  id:
    | 'frontDesk'
    | 'reservations'
    | 'housekeeping'
    | 'nightAudit'
    | 'finance'
    | 'revenue'
    | 'manager'
    | 'guesthouse';
  roles: readonly string[];
  lessons: readonly Lesson[];
}

const L = (id: string, helpKey: string, kind: LessonKind, minutes: number, to?: AppPath): Lesson => ({
  id,
  titleKey: `learn.lessons.${id}`,
  helpKey,
  kind,
  minutes,
  ...(to ? { to } : {}),
});

const shell = L('shell', 'app.shell', 'tour', 3, '/today');
const record = L('record', 'app.record', 'tour', 3);
const practise = L('practise', 'learning.practise', 'practice', 10, '/learn');

/** Role learning paths (experience architecture §4). Lesson content is hosted on the website (help map). */
export const LEARNING_PATHS: readonly LearningPath[] = [
  {
    id: 'frontDesk',
    roles: ['front_desk', 'night_auditor', 'general_manager', 'org_admin'],
    lessons: [
      shell,
      L('arrivals', 'frontDesk.arrivals', 'tour', 4, '/front-desk/arrivals'),
      record,
      L('checkIn', 'reservations.checkIn', 'video', 6, '/front-desk/arrivals'),
      L('preview', 'reservations.changePreview', 'tour', 3, '/reservations/timeline'),
      L('pending', 'payments.pendingVerification', 'article', 4),
      practise,
    ],
  },
  {
    id: 'reservations',
    roles: ['reservations_agent', 'general_manager', 'org_admin'],
    lessons: [
      shell,
      L('timeline', 'reservations.timeline', 'tour', 4, '/reservations/timeline'),
      record,
      L('preview', 'reservations.changePreview', 'tour', 3, '/reservations/timeline'),
      L('conflict', 'app.conflict', 'article', 3),
      practise,
    ],
  },
  {
    id: 'housekeeping',
    roles: ['housekeeping_supervisor', 'housekeeping_attendant', 'general_manager'],
    lessons: [
      shell,
      L('board', 'housekeeping.board', 'tour', 4, '/housekeeping'),
      L('inspect', 'housekeeping.inspection', 'video', 5, '/housekeeping'),
      record,
      practise,
    ],
  },
  {
    id: 'nightAudit',
    roles: ['night_auditor'],
    lessons: [
      shell,
      L('dayClose', 'dayClose.run', 'video', 8),
      L('pending', 'payments.pendingVerification', 'article', 4),
      record,
      practise,
    ],
  },
  {
    id: 'finance',
    roles: ['finance'],
    lessons: [
      shell,
      L('folios', 'finance.folios', 'article', 6),
      L('pending', 'payments.pendingVerification', 'article', 4),
      record,
    ],
  },
  {
    id: 'revenue',
    roles: ['revenue_manager'],
    lessons: [
      shell,
      L('rates', 'rates.ratePlans', 'article', 6),
      L('timeline', 'reservations.timeline', 'tour', 4, '/reservations/timeline'),
    ],
  },
  {
    id: 'manager',
    roles: ['general_manager', 'org_admin'],
    lessons: [
      shell,
      L('today', 'overview.today', 'tour', 3, '/today'),
      L('users', 'settings.users', 'article', 4, '/settings/users'),
      L('conflict', 'app.conflict', 'article', 3),
      practise,
    ],
  },
  {
    id: 'guesthouse',
    roles: ['org_admin'],
    lessons: [
      L('guesthouse', 'overview.guesthouse', 'video', 6, '/today'),
      L('arrivals', 'frontDesk.arrivals', 'tour', 4, '/front-desk/arrivals'),
      L('board', 'housekeeping.board', 'tour', 4, '/housekeeping'),
      practise,
    ],
  },
];

export function pathsFor(
  roleKeys: readonly string[],
  profile: string | null | undefined,
): { recommended: LearningPath[]; others: LearningPath[] } {
  const keys = new Set(roleKeys);
  const isGuesthouse = profile === 'guesthouse';
  const matches = (p: LearningPath) =>
    p.id === 'guesthouse' ? isGuesthouse && keys.has('org_admin') : p.roles.some((r) => keys.has(r));
  return { recommended: LEARNING_PATHS.filter(matches), others: LEARNING_PATHS.filter((p) => !matches(p)) };
}

export interface ChecklistItem {
  id: string;
  /** i18n key under learn.checklist */
  labelKey: string;
  /** Completed automatically when this event is recorded. */
  doneWhen: string;
  to?: AppPath;
}

const C = (id: string, doneWhen: string, to?: AppPath): ChecklistItem => ({
  id,
  labelKey: `learn.checklist.${id}`,
  doneWhen,
  ...(to ? { to } : {}),
});

/** First-run checklist per role (the first matching role wins). */
export function checklistFor(
  roleKeys: readonly string[],
): { roleKey: string; items: ChecklistItem[] } | null {
  const keys = new Set(roleKeys);
  if (keys.has('front_desk') || keys.has('night_auditor'))
    return {
      roleKey: keys.has('front_desk') ? 'front_desk' : 'night_auditor',
      items: [
        C('openArrivals', 'visit:frontDesk.arrivals', '/front-desk/arrivals'),
        C('openRecord', 'record:open'),
        C('search', 'palette:open'),
        C('preview', 'preview:open'),
        C('shortcuts', 'shortcuts:open'),
      ],
    };
  if (keys.has('housekeeping_supervisor') || keys.has('housekeeping_attendant'))
    return {
      roleKey: 'housekeeping_supervisor',
      items: [
        C('openBoard', 'visit:housekeeping.board', '/housekeeping'),
        C('openRecord', 'record:open'),
        C('search', 'palette:open'),
        C('shortcuts', 'shortcuts:open'),
      ],
    };
  if (keys.has('reservations_agent'))
    return {
      roleKey: 'reservations_agent',
      items: [
        C('openTimeline', 'visit:reservations.timeline', '/reservations/timeline'),
        C('openRecord', 'record:open'),
        C('preview', 'preview:open'),
        C('search', 'palette:open'),
      ],
    };
  if (keys.has('org_admin') || keys.has('general_manager'))
    return {
      roleKey: keys.has('org_admin') ? 'org_admin' : 'general_manager',
      items: [
        C('openToday', 'visit:overview.today', '/today'),
        C('openArrivals', 'visit:frontDesk.arrivals', '/front-desk/arrivals'),
        C('openRecord', 'record:open'),
        C('search', 'palette:open'),
        C('openUsers', 'visit:settings.users', '/settings/users'),
        C('practise', 'visit:learning.centre', '/learn'),
      ],
    };
  return null;
}
