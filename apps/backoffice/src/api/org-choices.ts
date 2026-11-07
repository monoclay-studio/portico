import { z } from 'zod';

/**
 * Organizations the signed-in account belongs to, as reported by POST /v1/auth/login. Remembered for this tab
 * so "Practise in training" can offer the training organization (it signs in again with organizationId).
 */
const KEY = 'portico.orgChoices.v1';
const schema = z.array(z.object({ id: z.string(), name: z.string(), environment: z.string() }));
export type OrgChoice = z.infer<typeof schema>[number];

export function rememberOrgChoices(list: OrgChoice[]) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // storage blocked
  }
}

export function orgChoices(): OrgChoice[] {
  try {
    const parsed = schema.safeParse(JSON.parse(sessionStorage.getItem(KEY) ?? '[]'));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}
