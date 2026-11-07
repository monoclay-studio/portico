# Foundation requests (operations)

## FR-1 — Boundary checker false positive on `${…}` interpolations (blocks `pnpm lint` after merge)

**Problem.** Once `modules/operations` and `modules/inventory` are both on the branch, `pnpm lint` fails:

```
Module boundary violations (1):
  modules/inventory/src/service/external.ts: raw SQL references operations.length — another module's schema
```

`tools/check-boundaries.mjs` scans the text of `sql\`…\`` templates for `<schema>.<name>`. Inventory's template
contains the **JavaScript interpolation** `${input.operations.length}` (a property called `operations`, not the
`operations` schema), so it matches. Neither module is wrong. I did not change `tools/` or `modules/inventory`
(outside operations' boundary).

**Proposed diff** (`tools/check-boundaries.mjs`, raw SQL check): drop interpolations before matching.

```diff
-      for (const block of text.matchAll(/sql(?:<[^>]*>)?`([^`]*)`/g)) {
-        for (const ref of (block[1] ?? '').matchAll(new RegExp(`\\b${sch}\\.[a-z_]+\\(?`, 'g'))) {
+      for (const block of text.matchAll(/sql(?:<[^>]*>)?`([^`]*)`/g)) {
+        const sqlText = (block[1] ?? '').replace(/\$\{[^}]*\}/g, '');
+        for (const ref of sqlText.matchAll(new RegExp(`\\b${sch}\\.[a-z_]+\\(?`, 'g'))) {
```

Workaround until then: none on the operations side (inventory could also rename the local variable).
