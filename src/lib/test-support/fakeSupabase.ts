/**
 * In-memory Supabase stand-in for testing `src/lib/queries.ts` and route-handler mutations without
 * a live database.
 *
 * Implements exactly the query-builder surface real call sites use (verified by grep):
 * `.select()`, `.eq()`, `.in()`, `.neq()`, `.gt()`, `.gte()`, `.is()`, `.not()`, `.or()`, `.order()`,
 * `.range()`, `.limit()`, `.maybeSingle()`, `.insert()`, `.delete()`. It is not a general
 * PostgREST/Supabase reimplementation — it covers real call shapes, nothing more (e.g. `.not()`
 * only supports the `'is'` operator, `.or()` only supports comma-joined `col.eq.val` clauses, and
 * `.insert()`/`.delete()` don't emulate unique/FK constraints or return errors, since none of the
 * routes this harness has exercised so far depend on the fake surfacing one).
 *
 * Embedded-resource selects (`weeks(week_number, seasons(name))`) are resolved against `FK_MAP`
 * and nested as a single object (to-one, matching the runtime shape Supabase actually returns —
 * queries.ts itself documents this with "Supabase types embedded to-one relations as arrays, but
 * returns objects at runtime") or an array (to-many, e.g. `weeks(matches(...))`). A to-many embed's
 * row order follows `.order(col, { referencedTable })`, scoped by the embed's key — this harness
 * doesn't distinguish two different to-many embeds that reuse the same key at different nesting
 * depths, since `queries.ts` never does that.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type Row = Record<string, unknown>;
export type FakeDb = Record<string, Row[]>;

// table -> embed key (the alias used in a select string) -> which column relates this table to
// which target table, and in which direction. 'one': `fk` lives on this table and points at the
// target's id (matches -> weeks). 'many': `fk` lives on the target table and points back at this
// row's id (weeks -> matches). Only covers the embeds queries.ts actually performs.
type EmbedMapping = { kind: 'one' | 'many'; fk: string; table: string };
const FK_MAP: Record<string, Record<string, EmbedMapping>> = {
  matches: {
    weeks: { kind: 'one', fk: 'week_id', table: 'weeks' },
    player_match_stats: { kind: 'many', fk: 'match_id', table: 'player_match_stats' },
  },
  weeks: {
    seasons: { kind: 'one', fk: 'season_id', table: 'seasons' },
    matches: { kind: 'many', fk: 'week_id', table: 'matches' },
  },
};

interface ParsedSelect {
  cols: string[];
  embeds: { key: string; inner: string }[];
}

function parseSelect(select: string): ParsedSelect {
  const cols: string[] = [];
  const embeds: { key: string; inner: string }[] = [];
  let depth = 0;
  let current = '';
  const parts: string[] = [];
  for (const ch of select) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);

  for (const raw of parts) {
    const part = raw.trim();
    if (!part) continue;
    const m = part.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\(([\s\S]*)\)$/);
    if (m) embeds.push({ key: m[1], inner: m[2] });
    else cols.push(part);
  }
  return { cols, embeds };
}

function resolveEmbed(
  table: string,
  row: Row,
  key: string,
  inner: string,
  db: FakeDb,
  referencedOrders: Record<string, OrderSpec[]>,
): unknown {
  const mapping = FK_MAP[table]?.[key];
  if (!mapping) {
    throw new Error(`fakeSupabase: no FK_MAP entry for "${table}.${key}" — add one in fakeSupabase.ts`);
  }
  if (mapping.kind === 'many') {
    let rows = (db[mapping.table] ?? []).filter((r) => r[mapping.fk] === row.id);
    const orderSpecs = referencedOrders[key];
    if (orderSpecs) rows = sortRows(rows, orderSpecs);
    return rows.map((r) => projectRow(mapping.table, r, inner, db, referencedOrders));
  }
  const fkVal = row[mapping.fk];
  const target = (db[mapping.table] ?? []).find((r) => r.id === fkVal);
  if (!target) return null;
  return projectRow(mapping.table, target, inner, db, referencedOrders);
}

function projectRow(
  table: string,
  row: Row,
  select: string,
  db: FakeDb,
  referencedOrders: Record<string, OrderSpec[]> = {},
): Row {
  const { cols, embeds } = parseSelect(select);
  const out: Row = cols.includes('*') ? { ...row } : {};
  if (!cols.includes('*')) {
    for (const c of cols) out[c] = row[c];
  }
  for (const e of embeds) out[e.key] = resolveEmbed(table, row, e.key, e.inner, db, referencedOrders);
  return out;
}

type FilterOp = 'eq' | 'neq' | 'gt' | 'gte' | 'in' | 'is' | 'not_is';
interface Filter {
  col: string;
  op: FilterOp;
  val: unknown;
}
interface OrClause {
  col: string;
  val: unknown;
}
interface OrderSpec {
  col: string;
  ascending: boolean;
}

function matchFilter(row: Row, f: Filter): boolean {
  const rv = row[f.col];
  switch (f.op) {
    case 'eq':
      return rv === f.val;
    case 'neq':
      return rv !== f.val;
    case 'gt':
      return (rv as number) > (f.val as number);
    case 'gte':
      return (rv as number) >= (f.val as number);
    case 'in':
      return (f.val as unknown[]).includes(rv);
    case 'is':
      return rv === f.val;
    case 'not_is':
      return f.val === null ? rv !== null : rv !== f.val;
  }
}

function coerceOrValue(raw: string): unknown {
  if (raw === 'null') return null;
  if (/^-?\d+$/.test(raw)) return Number(raw);
  return raw;
}

/** Shared by top-level `.order()` and a to-many embed's `.order(col, { referencedTable })`. */
function sortRows(rows: Row[], specs: OrderSpec[]): Row[] {
  return [...rows].sort((a, b) => {
    for (const spec of specs) {
      const av = a[spec.col] as string | number | null;
      const bv = b[spec.col] as string | number | null;
      if (av === bv) continue;
      if (av == null) return spec.ascending ? -1 : 1;
      if (bv == null) return spec.ascending ? 1 : -1;
      return av < bv ? (spec.ascending ? -1 : 1) : spec.ascending ? 1 : -1;
    }
    return 0;
  });
}

class FakeQueryBuilder<T = Row> implements PromiseLike<{ data: T[] | T | null; error: null }> {
  private filters: Filter[] = [];
  private orClauses: OrClause[] | null = null;
  private selectStr = '*';
  private orderSpecs: OrderSpec[] = [];
  private referencedOrders: Record<string, OrderSpec[]> = {};
  private rangeSpec: { from: number; to: number } | null = null;
  private limitN: number | null = null;
  private single = false;
  private mode: 'select' | 'insert' | 'delete' = 'select';
  private insertRows: Row[] = [];

  constructor(private table: string, private db: FakeDb) {}

  select(cols: string): this {
    this.selectStr = cols;
    return this;
  }
  /** Appends row(s) to the table — mirrors the mutation call shape route handlers use, e.g.
   * `.from('season_players').insert({ season_id, player_id })`. Doesn't emulate unique/FK
   * constraints; a route relying on the DB rejecting a duplicate insert needs a dedicated test. */
  insert(rows: Row | Row[]): this {
    this.mode = 'insert';
    this.insertRows = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  /** Marks this builder for row removal — the `.eq()` filters chained after `.delete()` select
   * which rows to remove, same as a real Supabase delete builder. */
  delete(): this {
    this.mode = 'delete';
    return this;
  }
  eq(col: string, val: unknown): this {
    this.filters.push({ col, op: 'eq', val });
    return this;
  }
  neq(col: string, val: unknown): this {
    this.filters.push({ col, op: 'neq', val });
    return this;
  }
  gt(col: string, val: unknown): this {
    this.filters.push({ col, op: 'gt', val });
    return this;
  }
  gte(col: string, val: unknown): this {
    this.filters.push({ col, op: 'gte', val });
    return this;
  }
  in(col: string, vals: unknown[]): this {
    this.filters.push({ col, op: 'in', val: vals });
    return this;
  }
  is(col: string, val: unknown): this {
    this.filters.push({ col, op: 'is', val });
    return this;
  }
  not(col: string, op: string, val: unknown): this {
    if (op !== 'is') throw new Error(`fakeSupabase: .not() only supports "is" (got "${op}")`);
    this.filters.push({ col, op: 'not_is', val });
    return this;
  }
  or(expr: string): this {
    this.orClauses = expr.split(',').map((clause) => {
      const [col, op, val] = clause.split('.');
      if (op !== 'eq') throw new Error(`fakeSupabase: .or() only supports "eq" clauses (got "${op}")`);
      return { col, val: coerceOrValue(val) };
    });
    return this;
  }
  order(col: string, opts?: { ascending?: boolean; referencedTable?: string }): this {
    const spec: OrderSpec = { col, ascending: opts?.ascending ?? true };
    if (opts?.referencedTable) {
      (this.referencedOrders[opts.referencedTable] ??= []).push(spec);
    } else {
      this.orderSpecs.push(spec);
    }
    return this;
  }
  range(from: number, to: number): this {
    this.rangeSpec = { from, to };
    return this;
  }
  limit(n: number): this {
    this.limitN = n;
    return this;
  }
  maybeSingle(): this {
    this.single = true;
    return this;
  }

  then<TResult1 = { data: T[] | T | null; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: T[] | T | null; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private matchesRow(row: Row): boolean {
    if (!this.filters.every((f) => matchFilter(row, f))) return false;
    if (this.orClauses) return this.orClauses.some((c) => row[c.col] === c.val);
    return true;
  }

  private async execute(): Promise<{ data: T[] | T | null; error: null }> {
    if (this.mode === 'insert') {
      const table = (this.db[this.table] ??= []);
      table.push(...this.insertRows.map((r) => ({ ...r })));
      return { data: null, error: null };
    }
    if (this.mode === 'delete') {
      const table = this.db[this.table] ?? [];
      this.db[this.table] = table.filter((row) => !this.matchesRow(row));
      return { data: null, error: null };
    }

    const table = this.db[this.table] ?? [];
    let rows = table.filter((row) => this.matchesRow(row));

    if (this.orderSpecs.length > 0) rows = sortRows(rows, this.orderSpecs);

    if (this.rangeSpec) {
      rows = rows.slice(this.rangeSpec.from, this.rangeSpec.to + 1);
    } else if (this.limitN != null) {
      rows = rows.slice(0, this.limitN);
    }

    const projected = rows.map((r) => projectRow(this.table, r, this.selectStr, this.db, this.referencedOrders)) as T[];

    if (this.single) {
      return { data: (projected[0] ?? null) as T | null, error: null };
    }
    return { data: projected, error: null };
  }
}

export class FakeSupabaseClient {
  constructor(private db: FakeDb) {}
  from<T = Row>(table: string): FakeQueryBuilder<T> {
    return new FakeQueryBuilder<T>(table, this.db);
  }
}

/** Build a fake client typed as `SupabaseClient` so it structurally satisfies every call site. */
export function createFakeSupabaseClient(db: FakeDb): SupabaseClient {
  return new FakeSupabaseClient(db) as unknown as SupabaseClient;
}
