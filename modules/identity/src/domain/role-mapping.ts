/**
 * Mapping from identity-provider groups to Portico role assignments. One model serves OIDC (groups claim), SCIM
 * (group membership) and — later — SAML (attribute statements): a rule says "members of group G get role R at
 * scope S". Assignments created by a mapping carry `source = 'sso' | 'scim'` and are reconciled on every sign-in
 * or group change; manually granted assignments are never touched by reconciliation.
 */
export type ScopeType = 'organization' | 'brand' | 'region' | 'property';

export interface GroupRoleMapping {
  id: string;
  group: string;
  roleKey: string;
  scopeType: ScopeType;
  scopeId: string | null;
}

export interface DesiredAssignment {
  roleKey: string;
  scopeType: ScopeType;
  scopeId: string | null;
  mappingId: string;
}

export interface ExistingMappedAssignment {
  assignmentId: string;
  roleKey: string;
  scopeType: ScopeType;
  scopeId: string | null;
}

/** Extract group names from a claim value (string, array of strings, or comma-separated string). */
export function groupsFromClaim(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string' && v.length > 0);
  if (typeof value === 'string' && value.length > 0)
    return value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  return [];
}

/** Group names are compared case-insensitively (IdPs differ in casing conventions). */
export function desiredAssignments(
  groups: readonly string[],
  mappings: readonly GroupRoleMapping[],
): DesiredAssignment[] {
  const held = new Set(groups.map((g) => g.toLowerCase()));
  const out = new Map<string, DesiredAssignment>();
  for (const m of mappings) {
    if (!held.has(m.group.toLowerCase())) continue;
    const key = assignmentKey(m);
    if (!out.has(key))
      out.set(key, { roleKey: m.roleKey, scopeType: m.scopeType, scopeId: m.scopeId, mappingId: m.id });
  }
  return [...out.values()];
}

export function assignmentKey(a: { roleKey: string; scopeType: ScopeType; scopeId: string | null }): string {
  return `${a.roleKey}|${a.scopeType}|${a.scopeId ?? ''}`;
}

/** What to grant and revoke so that mapped assignments equal the desired set. */
export function reconcileMappedAssignments(
  desired: readonly DesiredAssignment[],
  existing: readonly ExistingMappedAssignment[],
): { grant: DesiredAssignment[]; revoke: ExistingMappedAssignment[] } {
  const desiredKeys = new Set(desired.map(assignmentKey));
  const existingKeys = new Set(existing.map(assignmentKey));
  return {
    grant: desired.filter((d) => !existingKeys.has(assignmentKey(d))),
    revoke: existing.filter((e) => !desiredKeys.has(assignmentKey(e))),
  };
}

/** Email domain allow-list check (case-insensitive, exact domain — subdomains must be listed explicitly). */
/**
 * The one email parser for SSO decisions (review R2-P3-4): exactly one `@`, a non-empty local part and a domain such
 * as `lagoon.mv`. Returns the lower-cased domain, or null when the address is not well formed.
 */
export function emailDomain(email: string): string | null {
  const parts = email.trim().toLowerCase().split('@');
  if (parts.length !== 2 || !parts[0]) return null;
  const domain = parts[1] as string;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) ? domain : null;
}

export function emailDomainAllowed(email: string, allowedDomains: readonly string[]): boolean {
  const domain = emailDomain(email);
  if (!domain) return false;
  return allowedDomains.some((d) => d.toLowerCase() === domain);
}
