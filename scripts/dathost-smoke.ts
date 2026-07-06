// Live DatHost REST API probe (Phase-4 de-risking). The endpoint shapes in the handoff come from
// DatHost's docs, never from a call against our account — this script confirms the base path, auth,
// and (critically) the *connect-string shape + boot latency* the in-match "server starting…" UI
// depends on.
//
//   set -a; . ./.env.local; set +a            # loads DATHOST_EMAIL / DATHOST_PASSWORD
//   tsx scripts/dathost-smoke.ts              # READ-ONLY: list servers, dump field shapes
//   tsx scripts/dathost-smoke.ts --verify-update <serverId>
//                                             # SAFE no-op PUT to confirm the settings-update endpoint
//   tsx scripts/dathost-smoke.ts --startstop <serverId>
//                                             # REUSE (recommended prod path): start → read connect
//                                             #   → (optional loadmatch) → stop (NO delete)
//   tsx scripts/dathost-smoke.ts --lifecycle <goldenServerId> --yes
//                                             # CLONE (fallback): duplicate → start → connect → delete
//
// Env:
//   DATHOST_EMAIL, DATHOST_PASSWORD          (required) — HTTP Basic, the account's API password
// Flags:
//   --startstop <id>   start the existing persistent server, report connect, then stop it (no delete)
//   --lifecycle <id>   clone <id> (a tuned golden server) and run the full clone lifecycle
//   --loadmatch <url>  after start, issue `matchzy_loadmatch_url <url>` via console (optional)
//   --yes              required for --lifecycle (it creates a billable clone)
//
// Nothing here touches Supabase or DGLS state. It only talks to DatHost.

const BASE = 'https://dathost.com/api/0.1';

function authHeader(): string {
  const email = process.env.DATHOST_EMAIL;
  const password = process.env.DATHOST_PASSWORD;
  if (!email || !password) {
    console.error('✖ set DATHOST_EMAIL and DATHOST_PASSWORD (run: set -a; . ./.env.local; set +a)');
    process.exit(1);
  }
  return 'Basic ' + Buffer.from(`${email}:${password}`).toString('base64');
}

/** One DatHost call. Logs method/path/status; returns parsed JSON (or text) and the raw status. */
async function api(
  method: string,
  path: string,
  body?: URLSearchParams,
): Promise<{ status: number; data: unknown }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: authHeader(),
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body,
  });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* leave as text — printing raw is the point when shapes are unknown */
  }
  console.error(`  ${method} ${path} → ${res.status}`);
  if (res.status >= 400) {
    // Surface the error body — the whole point of probing is to see *why* a call fails. Truncate in
    // case it's an HTML page rather than a JSON error.
    const body = typeof data === 'string' ? data.slice(0, 600) : JSON.stringify(data);
    console.error(`    ↳ error body: ${body}`);
  }
  return { status: res.status, data };
}

/** Best-effort "connect ip:port" from a server object whose field names we don't yet trust. */
function deriveConnect(server: Record<string, unknown>): string | null {
  const raw = (server.raw_ip ?? server.ip) as string | undefined;
  const ports = server.ports as Record<string, unknown> | undefined;
  const port = (ports?.game ?? server.port ?? 27015) as number | string;
  if (!raw) return null;
  return `connect ${raw}:${port}`;
}

async function listServers() {
  console.error('— GET /game-servers (read-only) —');
  const { status, data } = await api('GET', '/game-servers');
  if (status !== 200) {
    console.error(`✖ list failed (${status}). Check the base path (/api/0.1), auth, and API password.`);
    console.error(JSON.stringify(data, null, 2));
    process.exit(1);
  }
  const servers = Array.isArray(data) ? data : [];
  console.error(`✓ auth + base path OK — ${servers.length} server(s):`);
  for (const s of servers as Record<string, unknown>[]) {
    console.error(`   • id=${s.id}  name=${JSON.stringify(s.name)}  game=${s.game}  on=${s.on}`);
  }
  // Dump one full object so we learn the real field names (ip/ports/status/etc).
  if (servers.length) {
    console.error('— sample server object (full shape) —');
    process.stdout.write(JSON.stringify(servers[0], null, 2) + '\n');
  }
  console.error('\nNext: pick a tuned golden server id and run with --lifecycle <id> --yes.');
}

/** Poll GET /game-servers/{id} until it reports running (or timeout); return elapsed ms + object. */
async function waitForBoot(id: string, timeoutMs = 120_000): Promise<{ ms: number; server: Record<string, unknown> }> {
  const start = Date.now();
  for (;;) {
    const { data } = await api('GET', `/game-servers/${id}`);
    const server = data as Record<string, unknown>;
    const elapsed = Date.now() - start;
    // Confirmed from a live read: a *stopped* server is on=false, booting=false. Ready = on AND not
    // booting. The ip/ports are pre-allocated even when off, so don't key readiness on the connect.
    const ready = server.on === true && server.booting !== true;
    if (ready && deriveConnect(server)) return { ms: elapsed, server };
    if (elapsed > timeoutMs) {
      console.error(`⚠ boot wait timed out after ${Math.round(elapsed / 1000)}s — dumping last state.`);
      return { ms: elapsed, server };
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

/**
 * Verify the settings-update mechanism SAFELY: read cs2_settings.game_mode, then PUT it back to the
 * SAME value (idempotent — changes nothing). Confirms verb (PUT), path (plural), and the dotted
 * nested field convention (`cs2_settings.game_mode`) we'll use to re-assert golden config at provision.
 */
async function verifyUpdate(id: string) {
  console.error(`— GET ${id} (read current cs2_settings.game_mode) —`);
  const got = await api('GET', `/game-servers/${id}`);
  const server = got.data as Record<string, unknown>;
  const cs2 = server.cs2_settings as Record<string, unknown> | undefined;
  const mode = cs2?.game_mode as string | undefined;
  if (!mode) {
    console.error('✖ could not read cs2_settings.game_mode — aborting (nothing changed).');
    process.exit(1);
  }
  console.error(`ℹ current game_mode = "${mode}" — PUTting the same value back (no-op).`);
  const put = await api('PUT', `/game-servers/${id}`, new URLSearchParams({ 'cs2_settings.game_mode': mode }));
  if (put.status >= 400) {
    console.error(`✖ PUT failed (${put.status}) — see error body above. Update endpoint not as expected.`);
    process.exit(1);
  }
  console.error(`✓ PUT /game-servers/{id} with dotted nested field → ${put.status}. Settings-update mechanism confirmed.`);
  console.error('  → provisioning can re-assert the full golden cs2_settings this way before start.');
}

/** start → wait for boot → print connect string → optional loadmatch. Returns false if start 400s. */
async function bootAndReport(id: string, loadmatchUrl?: string): Promise<boolean> {
  console.error(`— start ${id} —`);
  const started = await api('POST', `/game-servers/${id}/start`);
  if (started.status >= 400) {
    console.error(`✖ start failed (${started.status}) — see error body above. Skipping boot wait.`);
    return false;
  }

  console.error('— waiting for boot (timing the "server starting…" window) —');
  const { ms, server } = await waitForBoot(id);
  const connect = deriveConnect(server);
  console.error(`\n★ boot took ~${Math.round(ms / 1000)}s`);
  console.error(`★ connect string: ${connect ?? '(could not derive — inspect object below)'}`);
  console.error('— full booted server object —');
  process.stdout.write(JSON.stringify(server, null, 2) + '\n');

  if (loadmatchUrl) {
    console.error(`— console: matchzy_loadmatch_url ${loadmatchUrl} —`);
    await api('POST', `/game-servers/${id}/console`, new URLSearchParams({ line: `matchzy_loadmatch_url ${loadmatchUrl}` }));
  }
  return true;
}

/** Reuse path (recommended for production): start the existing server, report, then STOP (no delete). */
async function startStop(serverId: string, loadmatchUrl?: string) {
  try {
    await bootAndReport(serverId, loadmatchUrl);
  } finally {
    console.error(`— stop ${serverId} (no delete — it's the persistent golden server) —`);
    await api('POST', `/game-servers/${serverId}/stop`).catch((e) => console.error('⚠ stop failed — STOP MANUALLY in the panel:', e));
    console.error('✓ stopped (autostop_minutes is the backstop if this ever fails).');
  }
}

async function lifecycle(goldenId: string, loadmatchUrl?: string) {
  let cloneId: string | undefined;
  try {
    console.error(`— duplicate golden server ${goldenId} —`);
    const dup = await api('POST', `/game-servers/${goldenId}/duplicate`);
    const clone = dup.data as Record<string, unknown>;
    cloneId = clone?.id as string | undefined;
    if (!cloneId) {
      console.error('✖ duplicate did not return an id — dumping response and aborting (nothing to clean up):');
      console.error(JSON.stringify(dup.data, null, 2));
      process.exit(1);
    }
    console.error(`✓ clone id=${cloneId}`);
    await bootAndReport(cloneId, loadmatchUrl);
  } finally {
    if (cloneId) {
      console.error(`— teardown: stop + delete ${cloneId} —`);
      await api('POST', `/game-servers/${cloneId}/stop`).catch(() => {});
      await api('DELETE', `/game-servers/${cloneId}`).catch((e) => console.error('⚠ delete failed — DELETE MANUALLY in the panel:', e));
      console.error('✓ clone torn down (verify it is gone in the panel — it bills while it exists).');
    }
  }
}

function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i === -1) return undefined;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const loadmatchUrl = flagValue(args, '--loadmatch');

  // Verify the settings-update endpoint (safe idempotent no-op PUT).
  const vuId = flagValue(args, '--verify-update');
  if (vuId) {
    await verifyUpdate(vuId);
    return;
  }

  // Reuse path (recommended): start/stop the existing persistent server, never delete it.
  const ssId = flagValue(args, '--startstop');
  if (ssId) {
    await startStop(ssId, loadmatchUrl);
    return;
  }

  // Clone path (fallback — concurrency overflow / golden-image rebuild only).
  const goldenId = flagValue(args, '--lifecycle');
  if (goldenId) {
    if (!args.includes('--yes')) {
      console.error('⚠ --lifecycle creates a REAL, BILLABLE clone (duplicate → start → delete).');
      console.error('  Re-run with --yes to proceed.');
      process.exit(1);
    }
    await lifecycle(goldenId, loadmatchUrl);
    return;
  }

  // Default: read-only probe.
  await listServers();
}

main().catch((e) => {
  console.error('✖', e instanceof Error ? e.message : e);
  process.exit(1);
});
