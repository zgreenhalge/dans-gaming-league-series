/// <reference types="@cloudflare/workers-types" />
// Cloudflare Worker `ingest-demo` — Phase 2 of the DatHost + MatchZy initiative.
// See `dathost_handoff/DATHOST_PHASE0_PLAN.md`.
//
// MatchZy POSTs the raw GOTV `.dem` bytes (application/octet-stream) to this Worker after a map
// ends. Vercel can't receive it (4.5 MB request-body cap); a Worker streams the body straight to R2
// with no body limit. The Worker:
//   1. verifies the shared secret header (constant time) BEFORE reading the body,
//   2. reads MatchZy-MatchId → matchId, rejects MatchZy-MapNumber > 0 (BO1 only),
//   3. streams the body to R2 at `${matchId}/game.dem` (mirrors demoKey() in src/lib/r2.ts),
//   4. fire-and-forgets a notify POST to the Vercel route so parsing can proceed.
//
// The Worker only ever WRITES the demo to R2; the Vercel side only ever READS it.

export interface Env {
  // R2 bucket binding (the existing DGLS demos bucket). Configured in wrangler.toml.
  DEMOS: R2Bucket;
  // Shared secret MatchZy must send (matchzy_demo_upload_header_value). Set via `wrangler secret put`.
  UPLOAD_SECRET: string;
  // Vercel notify endpoint + its shared secret (x-ingest-secret == Vercel INGEST_NOTIFY_SECRET).
  NOTIFY_URL: string;
  NOTIFY_SECRET: string;
}

// MatchZy's configurable auth header. Keep in sync with the per-match config's
// matchzy_demo_upload_header_key. `X-MatchZy-Token` is the convention from the handoff.
const AUTH_HEADER = 'x-matchzy-token';

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function demoKey(matchId: number): string {
  return `${matchId}/game.dem`;
}

const worker: ExportedHandler<Env> = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    // 1. Auth — before touching the (large) body.
    if (!env.UPLOAD_SECRET || !constantTimeEqual(request.headers.get(AUTH_HEADER) ?? '', env.UPLOAD_SECRET)) {
      return new Response('Unauthorized', { status: 401 });
    }

    // 2. Identity + BO1 guard.
    const matchId = Number(request.headers.get('MatchZy-MatchId'));
    if (!Number.isInteger(matchId) || matchId <= 0) {
      return new Response('Bad or missing MatchZy-MatchId', { status: 400 });
    }
    const mapNumber = Number(request.headers.get('MatchZy-MapNumber') ?? '0');
    if (Number.isFinite(mapNumber) && mapNumber > 0) {
      // Multi-map config would overwrite the same key repeatedly. DGLS is BO1.
      return new Response(`Ignoring map ${mapNumber} (BO1 only)`, { status: 202 });
    }
    if (!request.body) {
      return new Response('Empty body', { status: 400 });
    }

    // 3. Stream the demo to R2 (no buffering of the whole file in memory).
    const key = demoKey(matchId);
    await env.DEMOS.put(key, request.body, {
      httpMetadata: { contentType: 'application/octet-stream' },
    });

    // 4. Fire-and-forget: tell Vercel a demo landed. Don't fail the upload if notify is flaky —
    //    the demo is safely in R2 and the manual flow can still pick it up.
    if (env.NOTIFY_URL && env.NOTIFY_SECRET) {
      ctx.waitUntil(
        fetch(env.NOTIFY_URL, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-ingest-secret': env.NOTIFY_SECRET,
          },
          body: JSON.stringify({ matchId }),
        }).catch(() => {}),
      );
    }

    return new Response(JSON.stringify({ ok: true, matchId, key }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  },
};

export default worker;
