# Foundation requests from the back office (wave 1)

Each item: problem → proposal. Worked around locally; nothing outside `packages/ui` and `apps/backoffice` was changed.

1. **Export contracts for the cross-module experience endpoints.** `GET /v1/search`, `/v1/records/:type/:id/summary`
   and `/history` declare their Zod schemas inline in `apps/api/src/records-routes.ts`, so web apps cannot import
   them. Proposal: move `searchHit`, `recordSummary`, `recordHistory` (and the universal record fields) to a
   contracts module, e.g. `@portico/kernel/contracts` (Zod-only) or a new `packages/contracts`. Workaround:
   mirrored in `apps/backoffice/src/api/endpoints.ts`.
2. **`GET /v1/roles` response contract** (identity). The route has no response schema; the client mirrors
   `identity.listRoles` (`is_system` is snake_case, unlike other contracts). Proposal: `roleSummary` in
   `@portico/identity/contracts` with camelCase `isSystem`.
3. **Effective permissions in `/v1/me`.** The UI derives workspaces from role keys. Proposal: add
   `permissions: Array<{ key, scope: 'all' | propertyIds[] }>` (or `can` per record type) so the UI hides actions
   exactly as the server would. Server enforcement stays authoritative.
4. **List the signed-in account's organizations** (`GET /v1/me/organizations`) so organization switching and
   "Practise in training" do not need the password again. Proposal: return `{ id, name, environment }[]` for
   active memberships; switching still issues a new session through an explicit endpoint.
5. **History: distinguish "no entries" from "not permitted" only for permitted readers.** Today both are 404
   (by design for non-readers). The UI shows "nothing recorded yet" for a 404 on a readable type. Proposal: return
   `200 { items: [] }` when the caller may read the record type and nothing is recorded.
6. **Missing mutations for screens that already exist:** `PATCH /v1/legal-entities/:id` (If-Match) and role
   assignment/revocation endpoints. The record drawer shows these actions disabled with that reason.
7. **Record route templates**: platform's manifest uses `/settings/properties/:id`; the back office adopted
   `/settings/*` to match. Proposal: document route templates as part of the record contract in domain-map so each
   module's `route` resolves in every web app.
