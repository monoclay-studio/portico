/**
 * SCIM 2.0 (RFC 7643/7644) helpers: the subset enterprise IdPs (Entra ID, Okta, Google) actually send for user
 * and group provisioning. Pure parsing — no IO.
 */
export const SCIM_USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
export const SCIM_GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group';
export const SCIM_LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
export const SCIM_PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
export const SCIM_ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';

export interface ScimFilter {
  attribute: 'userName' | 'externalId' | 'displayName' | 'id';
  value: string;
}

/**
 * Supports `attr eq "value"` for userName, externalId, displayName and id — what IdPs use to look up an
 * existing resource before creating it. Anything else returns null (callers answer 400 invalidFilter).
 */
export function parseScimFilter(filter: string | undefined): ScimFilter | null | undefined {
  if (filter === undefined || filter.trim() === '') return undefined;
  const m = /^\s*(userName|externalId|displayName|id)\s+eq\s+"((?:[^"\\]|\\.)*)"\s*$/i.exec(filter);
  if (!m) return null;
  const attr = (m[1] ?? '').toLowerCase();
  const attribute = (
    { username: 'userName', externalid: 'externalId', displayname: 'displayName', id: 'id' } as const
  )[attr as 'username' | 'externalid' | 'displayname' | 'id'];
  return { attribute, value: (m[2] ?? '').replace(/\\(.)/g, '$1') };
}

export interface ScimUserChanges {
  active?: boolean;
  displayName?: string;
  externalId?: string;
}

export interface ScimGroupChanges {
  displayName?: string;
  addMembers: string[];
  removeMembers: string[];
  replaceMembers?: string[];
}

export interface ScimPatchOperation {
  op: string;
  path?: string;
  value?: unknown;
}

function asBool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === 'True') return true;
  if (v === 'false' || v === 'False') return false;
  return undefined;
}

/** Interpret PatchOp operations on a User. Unknown paths are reported so the caller can answer 400. */
export function interpretUserPatch(ops: readonly ScimPatchOperation[]): {
  changes: ScimUserChanges;
  unsupported: string[];
} {
  const changes: ScimUserChanges = {};
  const unsupported: string[] = [];
  const apply = (path: string, value: unknown) => {
    switch (path.toLowerCase()) {
      case 'active': {
        const b = asBool(value);
        if (b === undefined) unsupported.push(path);
        else changes.active = b;
        return;
      }
      case 'displayname':
        if (typeof value === 'string') changes.displayName = value;
        else unsupported.push(path);
        return;
      case 'externalid':
        if (typeof value === 'string') changes.externalId = value;
        else unsupported.push(path);
        return;
      case 'name.formatted':
        if (typeof value === 'string') changes.displayName = value;
        return;
      default:
        unsupported.push(path);
    }
  };
  for (const op of ops) {
    const kind = op.op.toLowerCase();
    if (kind !== 'replace' && kind !== 'add') {
      unsupported.push(`${op.op}:${op.path ?? ''}`);
      continue;
    }
    if (op.path) apply(op.path, op.value);
    else if (op.value && typeof op.value === 'object') {
      for (const [k, v] of Object.entries(op.value as Record<string, unknown>)) apply(k, v);
    } else unsupported.push(op.op);
  }
  return { changes, unsupported };
}

function memberIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((m) => (m && typeof m === 'object' ? (m as { value?: unknown }).value : undefined))
    .filter((v): v is string => typeof v === 'string');
}

/** Interpret PatchOp operations on a Group (membership changes and renames). */
export function interpretGroupPatch(ops: readonly ScimPatchOperation[]): {
  changes: ScimGroupChanges;
  unsupported: string[];
} {
  const changes: ScimGroupChanges = { addMembers: [], removeMembers: [] };
  const unsupported: string[] = [];
  for (const op of ops) {
    const kind = op.op.toLowerCase();
    const path = op.path ?? '';
    // Entra ID sends: { op: 'remove', path: 'members[value eq "<id>"]' }
    const filtered = /^members\[value eq "([^"]+)"\]$/i.exec(path);
    if (kind === 'add' && path.toLowerCase() === 'members') changes.addMembers.push(...memberIds(op.value));
    else if (kind === 'remove' && filtered?.[1]) changes.removeMembers.push(filtered[1]);
    else if (kind === 'remove' && path.toLowerCase() === 'members') {
      const ids = memberIds(op.value);
      if (ids.length) changes.removeMembers.push(...ids);
      else changes.replaceMembers = [];
    } else if (kind === 'replace' && path.toLowerCase() === 'members')
      changes.replaceMembers = memberIds(op.value);
    else if ((kind === 'replace' || kind === 'add') && path.toLowerCase() === 'displayname') {
      if (typeof op.value === 'string') changes.displayName = op.value;
      else unsupported.push(path);
    } else if (kind === 'replace' && !op.path && op.value && typeof op.value === 'object') {
      const v = op.value as Record<string, unknown>;
      if (typeof v.displayName === 'string') changes.displayName = v.displayName;
      if (Array.isArray(v.members)) changes.replaceMembers = memberIds(v.members);
    } else unsupported.push(`${op.op}:${path}`);
  }
  return { changes, unsupported };
}

/** Display name from a SCIM user payload: displayName, then name.formatted, then given + family, then userName. */
export function scimDisplayName(input: {
  userName: string;
  displayName?: string | undefined;
  name?:
    | { formatted?: string | undefined; givenName?: string | undefined; familyName?: string | undefined }
    | undefined;
}): string {
  if (input.displayName?.trim()) return input.displayName.trim();
  if (input.name?.formatted?.trim()) return input.name.formatted.trim();
  const parts = [input.name?.givenName, input.name?.familyName].filter((p): p is string => !!p?.trim());
  if (parts.length) return parts.join(' ');
  return input.userName;
}
