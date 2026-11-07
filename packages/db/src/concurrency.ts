import { NotFoundError, VersionConflictError } from '@portico/kernel';

/**
 * Check an optimistic-concurrency precondition after a conditional UPDATE.
 * Pattern:
 *   const row = await tx.db.updateTable(t).set({...values, version: sql`version + 1`})
 *     .where('id','=',id).where('version','=',expected).returningAll().executeTakeFirst();
 *   if (!row) await explainVersionMiss(...)
 */
export async function explainVersionMiss(
  entity: string,
  id: string,
  expected: number,
  loadCurrentVersion: () => Promise<number | undefined>,
): Promise<never> {
  const current = await loadCurrentVersion();
  if (current === undefined) throw new NotFoundError(entity, id);
  throw new VersionConflictError(entity, id, expected, current);
}

/** Parse an HTTP ETag / If-Match value of the form W/"<version>" or "<version>". */
export function parseVersionTag(tag: string | undefined | null): number | undefined {
  if (!tag) return undefined;
  const m = /^(?:W\/)?"?(\d+)"?$/.exec(tag.trim());
  return m ? Number(m[1]) : undefined;
}

export function versionTag(version: number): string {
  return `W/"${version}"`;
}
