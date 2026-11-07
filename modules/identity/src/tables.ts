import type { Generated } from '@portico/db';

export interface IdentityDB {
  'identity.users': {
    id: string;
    email: string;
    password_hash: string | null;
    status: Generated<'active' | 'locked' | 'disabled'>;
    failed_logins: Generated<number>;
    locked_until: Date | null;
    mfa_secret_enc: string | null;
    created_at: Generated<Date>;
    updated_at: Generated<Date>;
  };
  'identity.memberships': {
    id: string;
    tenant_id: string;
    user_id: string;
    display_name: string;
    job_title: string | null;
    status: Generated<'invited' | 'active' | 'suspended' | 'removed'>;
    default_property_id: string | null;
    created_at: Generated<Date>;
    updated_at: Generated<Date>;
    version: Generated<number>;
  };
  'identity.roles': {
    id: string;
    tenant_id: string;
    key: string;
    name: string;
    description: Generated<string>;
    permissions: string[];
    is_system: Generated<boolean>;
    created_at: Generated<Date>;
    version: Generated<number>;
  };
  'identity.role_assignments': {
    id: string;
    tenant_id: string;
    user_id: string;
    role_id: string;
    scope_type: 'organization' | 'brand' | 'region' | 'property';
    scope_id: string | null;
    starts_at: Date | null;
    ends_at: Date | null;
    granted_by: string;
    reason: string | null;
    created_at: Generated<Date>;
    revoked_at: Date | null;
  };
  'identity.sessions': {
    id: string;
    tenant_id: string;
    user_id: string;
    token_hash: string;
    created_at: Generated<Date>;
    expires_at: Date;
    idle_expires_at: Date;
    last_seen_at: Generated<Date>;
    revoked_at: Date | null;
    revoked_reason: string | null;
    mfa_verified: Generated<boolean>;
    ip: string | null;
    user_agent: string | null;
  };
  'identity.api_clients': {
    id: string;
    tenant_id: string;
    name: string;
    secret_hash: string;
    permissions: string[];
    property_ids: string[] | null;
    status: Generated<'active' | 'revoked'>;
    created_by: string;
    created_at: Generated<Date>;
    expires_at: Date | null;
    last_used_at: Date | null;
  };
}
