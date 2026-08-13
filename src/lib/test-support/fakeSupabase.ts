/**
 * In-memory Supabase stand-in for testing `src/lib/queries.ts` and route-handler mutations without
 * a live database.
 *
 * Implements exactly the query-builder surface real call sites use (verified by grep):
 * `.select()`, `.eq()`, `.in()`, `.neq()`, `.gt()`, `.gte()`, `.lte()`, `.is()`, `.not()`, `.or()`,
 * `.order()`, `.range()`, `.limit()`, `.single()`, `.maybeSingle()`, `.insert()`, `.update()`,
 * `.upsert()`, `.delete()`, plus `.rpc()` on the client itself. It is not a general
 * PostgREST/Supabase reimplementation — it covers real call shapes, nothing more (e.g. `.not()`
 * only supports the `'is'` operator, `.or()` only supports the `eq`/`is`/`neq`/`gt`/`gte`/`lt`/`lte`
 * comparators real call sites use, and `.insert()`/`.delete()`/`.update()`/`.upsert()` don't emulate
 * unique/FK constraints or return errors, since none of the routes this harness has exercised so far
 * depend on the fake surfacing one — a call site that needs a specific error shape back (e.g. a
 * unique-violation) builds it in its own test file rather than this shared one).
 *
 * `.insert()`/`.upsert()` assign an auto-incrementing `id` (current max in the table + 1) to any row
 * that doesn't already specify one, mirroring a real serial primary key — this only matters when a
 * caller chains `.select().single()`/`.maybeSingle()` after the write to read the generated id back,
 * same as `materializePod()`'s `.insert({...}).select('id').single()`.
 *
 * `.rpc(name, args)` has no generic in-memory equivalent — RPC bodies are arbitrary SQL/PL-pgSQL —
 * so a test registers a fake implementation per RPC name via `createFakeSupabaseClient(db, {
 * [name]: (args, db) => ... })` rather than this file trying to interpret one generically.
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

type FilterOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lte' | 'in' | 'is' | 'not_is';
interface Filter {
  col: string;
  op: FilterOp;
  val: unknown;
}
type OrOp = 'eq' | 'neq' | 'is' | 'gt' | 'gte' | 'lt' | 'lte';
interface OrClause {
  col: string;
  op: OrOp;
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
    case 'lte':
      return (rv as string | number) <= (f.val as string | number);
    case 'in':
      return (f.val as unknown[]).includes(rv);
    case 'is':
      return rv === f.val;
    case 'not_is':
      return f.val === null ? rv !== null : rv !== f.val;
  }
}

/** Shared by `.or()` clauses (e.g. `col.lte.val`) — a separate, slightly wider operator set than
 * `matchFilter`'s since `.or()` expressions this codebase builds mix comparators freely
 * (`schedule_draft_locked_at.is.null,schedule_draft_locked_at.lte.${cutoff}`). */
function matchOrClause(row: Row, c: OrClause): boolean {
  const rv = row[c.col];
  switch (c.op) {
    case 'eq':
    case 'is':
      return rv === c.val;
    case 'neq':
      return rv !== c.val;
    case 'gt':
      return (rv as number) > (c.val as number);
    case 'gte':
      return (rv as number) >= (c.val as number);
    case 'lt':
      return (rv as string | number) < (c.val as string | number);
    case 'lte':
      return (rv as string | number) <= (c.val as string | number);
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

/** Assigns the next auto-increment id for a table (current max numeric `id` + 1, or 1 if empty) —
 * mirrors a real serial primary key closely enough for `.insert(...).select('id').single()` chains
 * to read back a generated id, without modeling actual sequence/gap semantics. */
function nextId(rows: Row[]): number {
  let max = 0;
  for (const r of rows) {
    if (typeof r.id === 'number' && r.id > max) max = r.id;
  }
  return max + 1;
}

class FakeQueryBuilder<T = Row> implements PromiseLike<{ data: T[] | T | null; error: null }> {
  private filters: Filter[] = [];
  private orClauses: OrClause[] | null = null;
  private selectStr = '*';
  private selectCalled = false;
  private orderSpecs: OrderSpec[] = [];
  private referencedOrders: Record<string, OrderSpec[]> = {};
  private rangeSpec: { from: number; to: number } | null = null;
  private limitN: number | null = null;
  private singleMode = false;
  private mode: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
  private insertRows: Row[] = [];
  private updateValues: Row = {};
  private upsertRows: Row[] = [];
  private upsertConflict: string[] = ['id'];
  private upsertIgnoreDuplicates = false;

  constructor(private table: string, private db: FakeDb) {}

  select(cols: string): this {
    this.selectStr = cols;
    this.selectCalled = true;
    return this;
  }
  /** Appends row(s) to the table — mirrors the mutation call shape route handlers use, e.g.
   * `.from('season_players').insert({ season_id, player_id })`. Doesn't emulate unique/FK
   * constraints; a route relying on the DB rejecting a duplicate insert needs a dedicated test.
   * Any row missing `id` gets one auto-assigned (see `nextId()`); the assigned/inserted rows are
   * only returned in `data` if `.select()` was chained, same as real Supabase. */
  insert(rows: Row | Row[]): this {
    this.mode = 'insert';
    this.insertRows = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  /** Applies `values` to every row matching the filters/or-clauses built up by the chained
   * `.eq()`/`.in()`/etc. calls, reusing the same `matchesRow()` logic `.delete()` relies on.
   * Matching is evaluated against each row's pre-update state, same as a real `UPDATE ... WHERE`. */
  update(values: Row): this {
    this.mode = 'update';
    this.updateValues = values;
    return this;
  }
  /** Insert-or-update by `opts.onConflict` (comma-separated column list; defaults to `'id'`) —
   * matches an existing row by equality on every listed column, updates it in place (unless
   * `opts.ignoreDuplicates`, which leaves it untouched), else inserts a new row. */
  upsert(rows: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }): this {
    this.mode = 'upsert';
    this.upsertRows = Array.isArray(rows) ? rows : [rows];
    this.upsertConflict = (opts?.onConflict ?? 'id').split(',').map((c) => c.trim());
    this.upsertIgnoreDuplicates = opts?.ignoreDuplicates ?? false;
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
  lte(col: string, val: unknown): this {
    this.filters.push({ col, op: 'lte', val });
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
  /** Only supports comma-joined `col.op.val` clauses with `op` one of `eq`/`is`/`neq`/`gt`/`gte`/
   * `lt`/`lte` (real call shapes only — see file header). `val` is split off after the second `.`
   * rather than by a naive `.split('.')`, so an ISO timestamp value (which itself contains a `.`
   * before its milliseconds) survives intact. */
  or(expr: string): this {
    this.orClauses = expr.split(',').map((clause) => {
      const first = clause.indexOf('.');
      const second = clause.indexOf('.', first + 1);
      if (first === -1 || second === -1) {
        throw new Error(`fakeSupabase: malformed .or() clause "${clause}" (expected "col.op.val")`);
      }
      const col = clause.slice(0, first);
      const op = clause.slice(first + 1, second) as OrOp;
      const val = clause.slice(second + 1);
      if (!['eq', 'is', 'neq', 'gt', 'gte', 'lt', 'lte'].includes(op)) {
        throw new Error(`fakeSupabase: .or() doesn't support operator "${op}" (clause "${clause}")`);
      }
      return { col, op, val: coerceOrValue(val) };
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
  /** Same behavior as `.maybeSingle()` in this fake — real Supabase's `.single()` additionally
   * errors on zero or multiple matched rows, but nothing in this codebase's tests currently depends
   * on that distinction (see file header on constraint/error emulation). */
  single(): this {
    this.singleMode = true;
    return this;
  }
  maybeSingle(): this {
    this.singleMode = true;
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
    if (this.orClauses) return this.orClauses.some((c) => matchOrClause(row, c));
    return true;
  }

  /** Shared by the insert/update/upsert branches: `.select()` wasn't chained → real Supabase
   * returns `data: null`; otherwise project the affected rows and respect `.single()`/
   * `.maybeSingle()`. */
  private projectWrite(rows: Row[]): { data: T[] | T | null; error: null } {
    if (!this.selectCalled) return { data: null, error: null };
    const projected = rows.map((r) => projectRow(this.table, r, this.selectStr, this.db, this.referencedOrders)) as T[];
    if (this.singleMode) return { data: (projected[0] ?? null) as T | null, error: null };
    return { data: projected, error: null };
  }

  private async execute(): Promise<{ data: T[] | T | null; error: null }> {
    if (this.mode === 'insert') {
      const table = (this.db[this.table] ??= []);
      let counter = nextId(table);
      const inserted = this.insertRows.map((r) => {
        const row: Row = { ...r };
        if (row.id === undefined) row.id = counter++;
        table.push(row);
        return row;
      });
      return this.projectWrite(inserted);
    }
    if (this.mode === 'update') {
      const table = this.db[this.table] ?? [];
      const matched: Row[] = [];
      for (const row of table) {
        if (this.matchesRow(row)) {
          Object.assign(row, this.updateValues);
          matched.push(row);
        }
      }
      return this.projectWrite(matched);
    }
    if (this.mode === 'upsert') {
      const table = (this.db[this.table] ??= []);
      const results: Row[] = [];
      for (const incoming of this.upsertRows) {
        const existing = table.find((row) => this.upsertConflict.every((col) => row[col] === incoming[col]));
        if (existing) {
          if (!this.upsertIgnoreDuplicates) Object.assign(existing, incoming);
          results.push(existing);
        } else {
          const row: Row = { ...incoming };
          table.push(row);
          results.push(row);
        }
      }
      return this.projectWrite(results);
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

    if (this.singleMode) {
      return { data: (projected[0] ?? null) as T | null, error: null };
    }
    return { data: projected, error: null };
  }
}

/** A test-registered stand-in for one Postgres RPC's body — given the call's `args` and the live
 * `FakeDb`, returns (or resolves to) whatever `data` the real RPC would have returned. */
export type RpcHandler = (args: Record<string, unknown>, db: FakeDb) => unknown | Promise<unknown>;

export class FakeSupabaseClient {
  constructor(private db: FakeDb, private rpcHandlers: Record<string, RpcHandler> = {}) {}
  from<T = Row>(table: string): FakeQueryBuilder<T> {
    return new FakeQueryBuilder<T>(table, this.db);
  }
  /** Looks up a handler registered under `name` (see `createFakeSupabaseClient`'s second argument)
   * and runs it against the live fake db. Throws synchronously if nothing was registered for `name`
   * — a test exercising an `.rpc()` call site must register a fake implementation for it. */
  rpc(name: string, args: Record<string, unknown> = {}): PromiseLike<{ data: unknown; error: null }> {
    const handler = this.rpcHandlers[name];
    if (!handler) {
      throw new Error(
        `fakeSupabase: no .rpc() handler registered for "${name}" — pass one via createFakeSupabaseClient(db, { ${name}: (args, db) => ... })`,
      );
    }
    return Promise.resolve(handler(args, this.db)).then((data) => ({ data, error: null }));
  }
}

/** Build a fake client typed as `SupabaseClient` so it structurally satisfies every call site.
 * `rpcHandlers` supplies a fake implementation per RPC name for any `.rpc()` call sites exercised —
 * see `RpcHandler`. */
export function createFakeSupabaseClient(db: FakeDb, rpcHandlers: Record<string, RpcHandler> = {}): SupabaseClient {
  return new FakeSupabaseClient(db, rpcHandlers) as unknown as SupabaseClient;
}
