// Shared result shape for session-based access gates (`admin-access.ts`, `match-access.ts`,
// `season-roster-access.ts`) — every gate in this family already returned this discriminated union
// by convention; this is that convention given one real type instead of three parallel copies, so a
// future gate (e.g. a "season commissioner" tier) has an obvious shape to return. A caller's
// `if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })`
// narrows correctly against any gate built on this.
//
// `machine-auth.ts` is deliberately not built on this — it guards a different concern (a shared-secret
// header, not a player session) and already returns a ready-to-send `NextResponse | null` instead of
// a result its caller has to translate into one.
export type AccessResult<T extends object = Record<string, never>> =
  | ({ ok: true } & T)
  | { ok: false; status: number; error: string };
