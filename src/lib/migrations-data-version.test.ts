import { describe, expect, it } from 'vitest';
import { migrationFiles, publicTables, CREATE_TABLE, readMigration, stripComments } from './test-support/migrationSql';

// Every `public` table bumps `data_version` on write (supabase/migrations/20261021120000_add_data_version.sql),
// which is what retires the persistent read cache (`persistentQuery()`, src/lib/queries/_persistentCache.ts).
// A table whose writes don't bump it leaves cached reads stale, so this scans `supabase/migrations/`:
// a migration after the baseline that creates a `public` table must attach `bump_data_version()` to
// it in the same file — or the table must be in OPERATIONAL_TABLES, whose rows no cached read
// depends on. The baseline migration's own exclusion list must match OPERATIONAL_TABLES.

const BASELINE_MIGRATION = '20261021120000_add_data_version.sql';

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
  'scrim_sessions',
]);

const BUMP_TRIGGER = /\bcreate\s+trigger\s+\w+\s+after\s+[^;]*?\bon\s+(?:public\s*\.\s*)?(\w+)\s+for\s+each\s+statement\s+execute\s+function\s+(?:public\s*\.\s*)?bump_data_version\s*\(\)/gi;

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

  it('accepts a table with the trigger, or an operational table', () => {
    const sql = `
      create table public.foo (id int);
      create trigger bump_data_version after insert or update or delete on public.foo
        for each statement execute function public.bump_data_version();
      create table public.ops_errors (id int);
    `;
    expect(tablesMissingBump(sql)).toEqual([]);
  });
});

describe('supabase/migrations', () => {
  const files = migrationFiles();

  it('includes the data_version migration, whose exclusion list matches OPERATIONAL_TABLES', () => {
    expect(files).toContain(BASELINE_MIGRATION);
    const sql = stripComments(readMigration(BASELINE_MIGRATION));
    const list = sql.match(/tablename not in \(([^)]*)\)/i)?.[1] ?? '';
    const excluded = new Set([...list.matchAll(/'(\w+)'/g)].map((m) => m[1]));
    expect(excluded).toEqual(OPERATIONAL_TABLES);
  });

  it.each(files.filter((f) => f > BASELINE_MIGRATION))(
    '%s bumps data_version for every public table it creates',
    (file) => {
      expect(tablesMissingBump(readMigration(file))).toEqual([]);
    },
  );
});
