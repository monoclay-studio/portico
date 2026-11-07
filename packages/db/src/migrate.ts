import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModuleManifest } from '@portico/kernel';
import pg from 'pg';

export const CORE_MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations', 'core');

export interface MigrationSource {
  module: string;
  dir: string;
  migrateAfter?: string[];
}

export interface MigrateOptions {
  connectionString: string;
  sources: MigrationSource[];
  /** Development/test only: give the app role a login password. Production provisions roles via IaC. */
  appRolePassword?: string;
  log?: (msg: string) => void;
}

export function sourcesFromManifests(manifests: readonly ModuleManifest[]): MigrationSource[] {
  return manifests.map((m) => ({
    module: m.name,
    dir: m.migrationsDir,
    ...(m.migrateAfter ? { migrateAfter: m.migrateAfter } : {}),
  }));
}

/** Topologically order modules by `migrateAfter`, then alphabetically for determinism. */
export function orderSources(sources: MigrationSource[]): MigrationSource[] {
  const byName = new Map(sources.map((s) => [s.module, s]));
  const done = new Set<string>();
  const out: MigrationSource[] = [];
  const visit = (s: MigrationSource, stack: string[]) => {
    if (done.has(s.module)) return;
    if (stack.includes(s.module))
      throw new Error(`Migration dependency cycle: ${[...stack, s.module].join(' -> ')}`);
    for (const dep of s.migrateAfter ?? []) {
      const d = byName.get(dep);
      if (d) visit(d, [...stack, s.module]);
    }
    done.add(s.module);
    out.push(s);
  };
  for (const s of [...sources].sort((a, b) => a.module.localeCompare(b.module))) visit(s, []);
  return out;
}

const BOOTSTRAP_SQL = `
do $$ begin
  if not exists (select from pg_roles where rolname = 'portico_app') then
    create role portico_app nologin;
  end if;
end $$;
create schema if not exists core;
create table if not exists core.schema_migrations (
  module     text not null,
  name       text not null,
  checksum   text not null,
  applied_at timestamptz not null default now(),
  primary key (module, name)
);`;

export async function migrate(opts: MigrateOptions): Promise<{ applied: string[] }> {
  const log = opts.log ?? (() => {});
  const client = new pg.Client({ connectionString: opts.connectionString });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query(`select pg_advisory_lock(hashtext('portico_migrations'))`);
    await client.query(BOOTSTRAP_SQL);
    if (opts.appRolePassword) {
      await client.query(
        `alter role portico_app with login password '${opts.appRolePassword.replace(/'/g, "''")}'`,
      );
    }
    const ordered = [
      { module: 'core', dir: CORE_MIGRATIONS_DIR },
      ...orderSources(opts.sources.filter((s) => s.module !== 'core')),
    ];
    for (const source of ordered) {
      if (!existsSync(source.dir)) continue;
      const files = readdirSync(source.dir)
        .filter((f) => f.endsWith('.sql'))
        .sort();
      const { rows } = await client.query<{ name: string; checksum: string }>(
        'select name, checksum from core.schema_migrations where module = $1',
        [source.module],
      );
      const done = new Map(rows.map((r) => [r.name, r.checksum]));
      for (const file of files) {
        const content = readFileSync(join(source.dir, file), 'utf8');
        const checksum = createHash('sha256').update(content).digest('hex');
        const prior = done.get(file);
        if (prior) {
          if (prior !== checksum) {
            throw new Error(
              `Migration ${source.module}/${file} was modified after being applied. Merged migrations are immutable — add a new migration instead.`,
            );
          }
          continue;
        }
        log(`migrate ${source.module}/${file}`);
        await client.query('begin');
        try {
          await client.query(content);
          await client.query(
            'insert into core.schema_migrations (module, name, checksum) values ($1, $2, $3)',
            [source.module, file, checksum],
          );
          await client.query('commit');
        } catch (err) {
          await client.query('rollback');
          throw new Error(`Migration ${source.module}/${file} failed: ${(err as Error).message}`, {
            cause: err,
          });
        }
        applied.push(`${source.module}/${file}`);
      }
    }
  } finally {
    await client.query(`select pg_advisory_unlock(hashtext('portico_migrations'))`).catch(() => {});
    await client.end();
  }
  return { applied };
}
