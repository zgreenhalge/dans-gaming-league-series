import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Every `public` table has row level security on (AGENTS.md, "New tables must enable row level
// security"). This scans `supabase/migrations/` so a migration that creates a `public` table without
// `alter table ... enable row level security` in the same file fails CI.
//
// Migrations up to and including RLS_BASELINE_MIGRATION are exempt: that migration enables RLS on
// every `public` table that exists when it runs. Tables created in dynamic SQL (`execute format(...)`)
// are not seen by this check.

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../../supabase/migrations');
const RLS_BASELINE_MIGRATION = '20261008150000_enable_rls_revoke_anon.sql';

const IDENT = String.raw`(?:"([^"]+)"|(\w+))`;
const CREATE_TABLE = new RegExp(
  String.raw`\bcreate\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?(?:${IDENT}\s*\.\s*)?${IDENT}`,
  'gi',
);
const ENABLE_RLS = new RegExp(
  String.raw`\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:${IDENT}\s*\.\s*)?${IDENT}\s+enable\s+row\s+level\s+security`,
  'gi',
);

function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

/** `public` tables a migration's SQL creates, and those it enables RLS on (unqualified = `public`). */
function publicTables(sql: string, pattern: RegExp): Set<string> {
  const tables = new Set<string>();
  for (const m of stripComments(sql).matchAll(pattern)) {
    const schema = (m[1] ?? m[2])?.toLowerCase();
    const table = m[3] ?? m[4].toLowerCase();
    if (schema === undefined || schema === 'public') tables.add(table);
  }
  return tables;
}

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
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

  it('includes the RLS baseline migration', () => {
    expect(files).toContain(RLS_BASELINE_MIGRATION);
  });

  it.each(files.filter((f) => f > RLS_BASELINE_MIGRATION))(
    '%s enables RLS on every public table it creates',
    (file) => {
      expect(tablesMissingRls(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'))).toEqual([]);
    },
  );
});
