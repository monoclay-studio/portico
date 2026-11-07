import type { Resources } from './en';

type DeepPartial<T> = { [K in keyof T]?: T[K] extends string ? string : DeepPartial<T[K]> };

/**
 * Arabic — RTL locale STUB. It proves right-to-left layout (logical CSS properties, mirrored keyboard
 * navigation, Radix direction) and covers the shell. Translations are unreviewed placeholders and must be
 * reviewed by a professional translator before any guest- or staff-facing release. Missing keys fall back to
 * English. Dhivehi (dv, Thaana script, also RTL) is the likely staff locale for the Maldives — see README.
 */
export const ar: DeepPartial<Resources> = {
  app: {
    skipToContent: 'انتقل إلى المحتوى الرئيسي',
    mainNav: 'الرئيسية',
    search: 'بحث',
    commandPalette: 'لوحة الأوامر',
    shortcuts: 'اختصارات لوحة المفاتيح',
    signOut: 'تسجيل الخروج',
    language: 'اللغة',
    property: 'المنشأة',
    switchProperty: 'تبديل المنشأة',
    businessDate: 'تاريخ العمل',
    organization: 'المؤسسة',
  },
  nav: {
    workspaces: 'مساحات العمل',
    frontDesk: 'الاستقبال',
    arrivals: 'الوصول',
    housekeeping: 'التدبير المنزلي',
    reservations: 'الحجوزات',
    timeline: 'المخطط الزمني',
    administration: 'الإدارة',
    organization: 'المؤسسة',
    properties: 'المنشآت',
    legalEntities: 'الكيانات القانونية',
    users: 'المستخدمون والأدوار',
  },
  signIn: {
    title: 'تسجيل الدخول',
    email: 'البريد الإلكتروني للعمل',
    password: 'كلمة المرور',
    submit: 'تسجيل الدخول',
    chooseOrganization: 'اختر مؤسسة',
    continue: 'متابعة',
  },
  arrivals: {
    title: 'الوصول',
    guest: 'الضيف',
    eta: 'وقت الوصول المتوقع',
    blocker: 'العائق',
    readiness: 'الجاهزية',
  },
  ui: {
    common: { close: 'إغلاق', cancel: 'إلغاء', retry: 'حاول مرة أخرى', loading: 'جارٍ التحميل…' },
  },
};
