/** Parse a weak/strong ETag carrying an aggregate version (`W/"3"`), mirroring @portico/db versionTag. */
export function parseVersionTag(tag: string | null | undefined): number | undefined {
  if (!tag) return undefined;
  const m = /^(?:W\/)?"?(\d+)"?$/.exec(tag.trim());
  return m ? Number(m[1]) : undefined;
}

export function versionTag(version: number): string {
  return `W/"${version}"`;
}
