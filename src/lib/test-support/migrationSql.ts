import fs from 'node:fs';
import path from 'node:path';

// Helpers for tests that scan `supabase/migrations/` SQL.

export const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../../../supabase/migrations');

/** Migration file names, oldest first. */
export function migrationFiles(): string[] {
  return fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
}

export function readMigration(file: string): string {
  return fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
}

const IDENT = String.raw`(?:"([^"]+)"|(\w+))`;
export const CREATE_TABLE = new RegExp(
  String.raw`\bcreate\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?(?:${IDENT}\s*\.\s*)?${IDENT}`,
  'gi',
);
export const ENABLE_RLS = new RegExp(
  String.raw`\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:${IDENT}\s*\.\s*)?${IDENT}\s+enable\s+row\s+level\s+security`,
  'gi',
);

export function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

/** `public` tables a migration's SQL creates, and those it enables RLS on (unqualified = `public`). */
export function publicTables(sql: string, pattern: RegExp): Set<string> {
  const tables = new Set<string>();
  for (const m of stripComments(sql).matchAll(pattern)) {
    const schema = (m[1] ?? m[2])?.toLowerCase();
    const table = m[3] ?? m[4].toLowerCase();
    if (schema === undefined || schema === 'public') tables.add(table);
  }
  return tables;
}

/** Tables whose writes don't bump `data_version`, so no persistent read (`persistentQuery()`) may depend on them. */
export const OPERATIONAL_TABLES = new Set([
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
