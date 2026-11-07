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

## Added in the steward fix round

8. **Record history newest first** (`/v1/records/:type/:id/history?order=desc&limit=`, or a `lastChange` field on
   the summary). Today the route returns the OLDEST 500 entries, so "changed by" on a busy record can name the
   wrong person (SR P2-7). The conflict dialog uses the last entry it receives until then.
9. **One shared status-vocabulary contracts package** (kernel `contracts` or `packages/contracts`): booking, stay,
   unit condition, occupancy/discrepancy, unit availability, inventory cell, payment/authorization states and
   provenance are declared separately in reservations, operations, payments and `@portico/ui`. The UI renders an
   unknown value as a neutral chip (never a crash), but the lists should come from one place.
10. **Universal record facets in kernel** (`recordAction/Issue/Owner/Link`): duplicated in reservations,
    operations and payments contracts; `RecordModel` would map from the kernel types.
11. **Front-desk row additions** (reservations `frontDeskRow`), so the board needs no client-side guessing:
    `vip`, `unitTypeName`, and per blocker a short `summary` + `detail` + `owner` (department or person). The
    app derives the owner from the check key today (`data/front-desk.ts`).
12. **Operations provenance** lacks `delayed` / `incomplete` (CLAUDE.md §4.16) — the UI already renders both.
13. **Preferences API** (saved views shared to a role, density, pinned records) — views live in this browser now.
