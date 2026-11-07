# ADR-0002: PostgreSQL with Row Level Security for multi-tenancy

**Status:** Accepted · **Date:** 2026-11-07

## Context

Each hotel customer's information and money must be separate from every other customer's (brief §2, scenario 17). Application-only filtering fails on a single forgotten `where tenant_id = …`.

## Decision

Shared database, shared schemas, `tenant_id` on every tenant-owned row, RLS enabled **and forced** with a standard policy on `core.current_tenant_id()` (transaction-local setting). The app connects as `portico_app` (not owner, not superuser). Cross-tenant needs go only through reviewed SECURITY DEFINER functions returning routing metadata; those read from small directory tables without RLS that the app role cannot access directly.

## Consequences

Defense in depth: even a buggy query cannot read another tenant. Fail-closed when no tenant is set. Large enterprise customers can later be placed in dedicated databases/cells with the same code. Production must provision the migration owner and `portico_app` roles separately (IaC).
