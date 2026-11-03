import { describe, expect, it } from 'vitest';
import { migrationFiles, publicTables, CREATE_TABLE, DROP_TABLE, readMigration, stripComments } from './test-support/migrationSql';

// Every `public` table bumps `data_version` on write (supabase/migrations/20261021120000_add_data_version.sql,
// deferred to commit by 20261021130000_defer_data_version_bump.sql), which is what retires the
// persistent read cache (`persistentQuery()`, src/lib/queries/_persistentCache.ts).
// A table whose writes don't bump it leaves cached reads stale, so this scans `supabase/migrations/`:
// a migration after the baseline that creates a `public` table must attach `bump_data_version()` to
// it in the same file — or the table must be in OPERATIONAL_TABLES, whose rows no cached read
// depends on. The exclusion list in each migration that wires the triggers must match OPERATIONAL_TABLES,
// ignoring tables a later migration drops.

const BASELINE_MIGRATION = '20261021120000_add_data_version.sql';
const TRIGGER_MIGRATIONS = [BASELINE_MIGRATION, '20261021130000_defer_data_version_bump.sql'];

/** Tables whose writes don't bump `data_version`. */
const OPERATIONAL_TABLES = new Set([
  'data_version',
  'background_jobs',
  'config_set_files',
  'config_sets',
  'live_match_score',
  'match_discord_state',
  'match_server_state',
  'ops_errors',
]);

const BUMP_TRIGGER = /\bcreate\s+(?:constraint\s+)?trigger\s+\w+\s+after\s+[^;]*?\bon\s+(?:public\s*\.\s*)?(\w+)\s+(?:deferrable\s+initially\s+deferred\s+)?for\s+each\s+(?:statement|row)\s+execute\s+function\s+(?:public\s*\.\s*)?bump_data_version\s*\(\)/gi;

/** Tables `sql` attaches the bump trigger to. */
function bumpedTables(sql: string): Set<string> {
  return new Set([...stripComments(sql).matchAll(BUMP_TRIGGER)].map((m) => m[1].toLowerCase()));
}

/** `public` tables `sql` creates that neither bump `data_version` nor are operational. */
function tablesMissingBump(sql: string): string[] {
  const bumped = bumpedTables(sql);
  return [...publicTables(sql, CREATE_TABLE)].filter((t) => !bumped.has(t) && !OPERATIONAL_TABLES.has(t));
}

describe('tablesMissingBump', () => {
  it('flags a table created without the bump trigger', () => {
    expect(tablesMissingBump('create table public.foo (id int);')).toEqual(['foo']);
  });

  it('accepts a table with the trigger (statement-level or deferred per-row), or an operational table', () => {
    const sql = `
      create table public.foo (id int);
      create trigger bump_data_version after insert or update or delete on public.foo
        for each statement execute function public.bump_data_version();
      create table public.bar (id int);
      create constraint trigger bump_data_version after insert or update or delete on public.bar
        deferrable initially deferred for each row execute function public.bump_data_version();
      create table public.ops_errors (id int);
    `;
    expect(tablesMissingBump(sql)).toEqual([]);
  });
});

describe('supabase/migrations', () => {
  const files = migrationFiles();
  const dropped = new Set(files.flatMap((f) => [...publicTables(readMigration(f), DROP_TABLE)]));

  it.each(TRIGGER_MIGRATIONS)('%s exists, with an exclusion list matching OPERATIONAL_TABLES', (file) => {
    expect(files).toContain(file);
    const sql = stripComments(readMigration(file));
    const list = sql.match(/tablename not in \(([^)]*)\)/i)?.[1] ?? '';
    const excluded = new Set([...list.matchAll(/'(\w+)'/g)].map((m) => m[1]).filter((t) => !dropped.has(t)));
    expect(excluded).toEqual(OPERATIONAL_TABLES);
  });

  it.each(files.filter((f) => f > BASELINE_MIGRATION))(
    '%s bumps data_version for every public table it creates',
    (file) => {
      expect(tablesMissingBump(readMigration(file))).toEqual([]);
    },
  );
});
