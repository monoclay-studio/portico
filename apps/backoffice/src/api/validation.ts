import type { TFunction } from 'i18next';
import type { z } from 'zod';

/**
 * Field messages in staff language (NAV-08): never a schema sentence like "Too small: expected string to have
 * >=1 characters". Client-side issues map by code; server messages that look like schema output are replaced.
 */
export function friendlyIssue(issue: z.core.$ZodIssue, t: TFunction): string {
  switch (issue.code) {
    case 'too_small':
      return issue.origin === 'string' && Number(issue.minimum) <= 1
        ? t('validation.required')
        : t('validation.tooShort', { min: String(issue.minimum) });
    case 'too_big':
      return t('validation.tooLong', { max: String(issue.maximum) });
    case 'invalid_format':
      return issue.format === 'email' ? t('validation.email') : t('validation.format');
    case 'invalid_value':
      return t('validation.choose');
    case 'invalid_type':
      return t('validation.required');
    default:
      return t('validation.check');
  }
}

const SCHEMA_SENTENCE = /^(Too (small|big)|Invalid (input|option|string|enum|type)|Expected |Required$)/i;

export function friendlyServerMessage(message: string, t: TFunction): string {
  return SCHEMA_SENTENCE.test(message) ? t('validation.check') : message;
}

export function issuesToErrors(issues: readonly z.core.$ZodIssue[], t: TFunction) {
  return issues.map((i) => ({ path: `/${i.path.join('/')}`, message: friendlyIssue(i, t) }));
}
