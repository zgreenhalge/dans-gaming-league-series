import { describe, expect, it } from 'vitest';
import { CREATE_TABLE, ENABLE_RLS, migrationFiles, publicTables, readMigration } from './test-support/migrationSql';

// Every `public` table has row level security on (AGENTS.md, "New tables must enable row level
// security"). This scans `supabase/migrations/` so a migration that creates a `public` table without
// `alter table ... enable row level security` in the same file fails CI.
//
// Migrations up to and including RLS_BASELINE_MIGRATION are exempt: that migration enables RLS on
// every `public` table that exists when it runs. Tables created in dynamic SQL (`execute format(...)`)
// are not seen by this check.

const RLS_BASELINE_MIGRATION = '20261008150000_enable_rls_revoke_anon.sql';

/** `public` tables `sql` creates without enabling RLS on them in the same SQL. */
function tablesMissingRls(sql: string): string[] {
  const enabled = publicTables(sql, ENABLE_RLS);
  return [...publicTables(sql, CREATE_TABLE)].filter((t) => !enabled.has(t));
}

describe('tablesMissingRls', () => {
  it('flags a public table created without RLS', () => {
    expect(tablesMissingRls('create table public.foo (id int);')).toEqual(['foo']);
    expect(tablesMissingRls('CREATE TABLE IF NOT EXISTS foo (id int);')).toEqual(['foo']);
  });

  it('accepts a table whose RLS is enabled in the same SQL', () => {
    const sql = `
      create table public.foo (id int);
      create table bar (id int);
      alter table public.foo enable row level security;
      ALTER TABLE ONLY bar ENABLE ROW LEVEL SECURITY;
    `;
    expect(tablesMissingRls(sql)).toEqual([]);
  });

  it('ignores other schemas, comments, and RLS enabled on a different table', () => {
    expect(tablesMissingRls('create table private.foo (id int);')).toEqual([]);
    expect(tablesMissingRls('-- create table public.foo (id int);')).toEqual([]);
    expect(
      tablesMissingRls('create table public.foo (id int); alter table public.foobar enable row level security;'),
    ).toEqual(['foo']);
  });
});

describe('supabase/migrations', () => {
  const files = migrationFiles();

  it('includes the RLS baseline migration', () => {
    expect(files).toContain(RLS_BASELINE_MIGRATION);
  });

  it.each(files.filter((f) => f > RLS_BASELINE_MIGRATION))(
    '%s enables RLS on every public table it creates',
    (file) => {
      expect(tablesMissingRls(readMigration(file))).toEqual([]);
    },
  );
});
