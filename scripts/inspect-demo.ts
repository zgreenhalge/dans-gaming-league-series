// Inspect a CS2 demo through DGLS's production parsers.
//
// Runs the exact parsers the app uses (`parseDemoFile` + `parseDemoSabremetrics`) against any demo —
// a local `.dem` or one pulled from R2 by match id — and prints what they produce: the derived
// score, per-player stats, sabremetrics, the demo-inferred starting side, and any warnings. Reads
// only; writes nothing (no R2, no DB), and has no session dependency.
//
// Handy for verifying parser output, debugging a specific match, checking a new demo source, or
// seeing what the pipeline would produce before it runs. Interpret the numbers against whatever
// source of truth applies to your case (scoreboard, official result, another tool).
//
// Usage:
//   tsx scripts/inspect-demo.ts --match 123                         # roster/side/target from DB
//   tsx scripts/inspect-demo.ts --match 123 --skins-side unknown    # ignore stored side; infer it
//   tsx scripts/inspect-demo.ts --demo ./game.dem --roster ./roster.json --skins-side CT
//
// Flags:
//   --demo <path>        local .dem file (gzip auto-detected). Mutually exclusive with --match.
//   --match <id>         pull the demo from R2 at demoKey(id) (needs CLOUDFLARE_R2_* + Supabase env).
//                        With --match, roster / skins-side / target default from the DB
//                        (getReplayInputs) — no --roster needed. --demo still requires --roster.
//   --roster <path>      JSON array of RosterEntry (REQUIRED for --demo; optional override for --match):
//                          [{ "player_id": 1, "faction": "SHIRTS",
//                             "steam_id": "7656119...", "name": "Zach",
//                             "steam_nickname": "zg" }, ...]
//                        steam_id must match the demo's accounts; name/steam_nickname are display.
//   --skins-side CT|T|unknown   the side SKINS started on. "unknown" → null, so the parser infers it
//                        from the demo. Default: the DB's stored side for --match, else "unknown".
//   --target <n>         target win rounds. Default: the DB's value for --match, else 13.
//   --json               print the full raw parser output as JSON instead of the readable report.

import { readFileSync } from 'node:fs';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { parseDemoFile, type RosterEntry, type DemoPlayerStat } from '../src/lib/demoParser';
import { parseDemoSabremetrics } from '../src/lib/demoOrchestrator';
import { getReplayInputs } from '../src/lib/replay/inputs';
import { getAdminClient } from '../src/lib/supabase-admin';
import { r2, R2_BUCKET, demoKey } from '../src/lib/r2';
import { gunzipMaybe } from '../src/lib/gzip';

// --- tiny arg parser (no deps) ---
function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function die(msg: string): never {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

async function loadDemoFromR2(matchId: number): Promise<Buffer> {
  const res = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: demoKey(matchId) }));
  if (!res.Body) die(`No demo in R2 at ${demoKey(matchId)}`);
  const chunks: Buffer[] = [];
  for await (const chunk of res.Body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function pad(s: string | number, w: number): string {
  return String(s).padEnd(w);
}
function padL(s: string | number, w: number): string {
  return String(s).padStart(w);
}

function printStatsTable(stats: DemoPlayerStat[], roster: RosterEntry[]): void {
  const nameOf = new Map(roster.map((r) => [r.player_id, r.name]));
  console.log(
    `\n${pad('PLAYER', 18)}${pad('FACTION', 9)}${padL('K', 4)}${padL('D', 4)}${padL('A', 4)}` +
      `${padL('DMG', 7)}${padL('ADR', 8)}${padL('RW', 4)}${padL('RP', 4)}${padL('WIN', 5)}`,
  );
  console.log('─'.repeat(71));
  for (const s of stats) {
    console.log(
      pad(nameOf.get(s.player_id) ?? `#${s.player_id}`, 18) +
        pad(s.faction, 9) +
        padL(s.kills, 4) +
        padL(s.deaths, 4) +
        padL(s.assists, 4) +
        padL(s.damage, 7) +
        padL(s.adr.toFixed(2), 8) +
        padL(s.rounds_won, 4) +
        padL(s.rounds_played, 4) +
        padL(s.is_win ? 'Y' : 'N', 5),
    );
  }
}

function printWarnings(warnings: string[]): void {
  if (warnings.length === 0) {
    console.log('\n✓ No warnings.');
    return;
  }
  console.log(`\n⚠ Warnings (${warnings.length}):`);
  for (const w of warnings) console.log(`   • ${w}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const hasDemo = typeof args.demo === 'string';
  const hasMatch = typeof args.match === 'string';
  if (hasDemo === hasMatch) {
    die('Provide exactly one of --demo <path> or --match <id>.');
  }
  const hasRoster = typeof args.roster === 'string';

  // For --match, roster / side / target default from the DB (getReplayInputs) — the same inputs the
  // app parses a match with — so a quick check is just `--match <id>`. --demo has no DB context.
  let dbRoster: RosterEntry[] | null = null;
  let dbSide: 'CT' | 'T' | null = null;
  let dbTarget = 13;
  if (hasMatch) {
    const inputs = await getReplayInputs(getAdminClient(), Number(args.match));
    dbRoster = inputs.roster as RosterEntry[];
    dbSide = inputs.skinsSide;
    dbTarget = inputs.targetWinRounds;
  }

  // Roster: an explicit --roster file wins; otherwise the DB roster (--match only).
  let roster: RosterEntry[];
  let rosterSource: string;
  if (hasRoster) {
    try {
      roster = JSON.parse(readFileSync(args.roster as string, 'utf8')) as RosterEntry[];
    } catch (e) {
      die(`Could not read/parse roster JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
    rosterSource = `file ${args.roster}`;
  } else if (dbRoster) {
    roster = dbRoster;
    rosterSource = 'DB (getReplayInputs)';
  } else {
    die('Missing --roster <path.json> (required with --demo). See the header for the shape.');
  }
  if (!Array.isArray(roster) || roster.length === 0) die('Roster must be a non-empty array.');

  // Side: --skins-side overrides; else the DB's stored side (--match) or unknown (--demo).
  let skinsSide: 'CT' | 'T' | null;
  const sideArg = args['skins-side'];
  if (typeof sideArg === 'string') {
    const sideRaw = sideArg.toUpperCase();
    if (sideRaw === 'CT') skinsSide = 'CT';
    else if (sideRaw === 'T') skinsSide = 'T';
    else if (sideRaw === 'UNKNOWN') skinsSide = null;
    else die(`--skins-side must be CT, T, or unknown (got "${sideRaw}").`);
  } else {
    skinsSide = dbSide;
  }

  const targetWinRounds = args.target ? Number(args.target) : dbTarget;
  if (!Number.isFinite(targetWinRounds) || targetWinRounds <= 0) die('--target must be a positive number.');

  // Demo bytes
  const rawBuf = hasDemo
    ? readFileSync(args.demo as string)
    : await loadDemoFromR2(Number(args.match));
  const demoBuffer = gunzipMaybe(rawBuf);

  console.log('\n=== demo inspection (production parsers) ===');
  console.log(`source        : ${hasDemo ? `file ${args.demo}` : `R2 ${demoKey(Number(args.match))}`}`);
  console.log(`demo size     : ${(demoBuffer.length / 1024 / 1024).toFixed(2)} MB`);
  console.log(`roster        : ${roster.length} players (${rosterSource})`);
  console.log(`stored side   : ${skinsSide ?? 'unknown (null → rely on demo inference)'}`);
  console.log(`target rounds : ${targetWinRounds}`);

  // Run the EXACT production parsers (same call as the parse route).
  const result = parseDemoFile(demoBuffer, roster, skinsSide, targetWinRounds);
  const sabre = parseDemoSabremetrics(demoBuffer, roster, skinsSide, targetWinRounds);
  const warnings = [...new Set([...result.warnings, ...sabre.warnings])];

  if (args.json) {
    console.log(JSON.stringify({ ...result, sabremetrics: sabre.sabremetrics, warnings }, null, 2));
    return;
  }

  printStatsTable(result.stats, roster);
  const effectiveSide = skinsSide ?? result.inferred_side;
  console.log(
    `\nInferred side  : skins ${result.inferred_side ?? 'could not infer'} (from demo round-1 team_num)`,
  );
  console.log(
    `Effective side : skins ${effectiveSide ?? 'none — score not derived'}` +
      `${skinsSide === null && result.inferred_side !== null ? '  ← inferred (no stored side)' : ''}` +
      `${skinsSide !== null && result.inferred_side !== null && skinsSide !== result.inferred_side ? '  ← STORED wins; demo disagrees!' : ''}`,
  );
  console.log(
    `Score (derived): SHIRTS ${result.shirts_score ?? '—'}  vs  SKINS ${result.skins_score ?? '—'}`,
  );
  console.log(`Rounds in history: ${result.round_history?.length ?? 0}`);

  // Sabremetrics: compact per-player line; full detail via --json.
  const nameOf = new Map(roster.map((r) => [r.player_id, r.name]));
  console.log('\nSabremetrics (compact — use --json for all fields):');
  for (const s of sabre.sabremetrics) {
    const name = nameOf.get(s.player_id) ?? `#${s.player_id}`;
    const f = s.sabremetrics;
    console.log(
      `   ${pad(name, 16)} HS:${padL(f.headshot_kills, 3)}  OPEN k/d:${padL(f.opening_kills, 2)}/${padL(f.opening_deaths, 2)}` +
        `  KAST rnds:${padL(f.kast_rounds, 3)}  2K:${padL(f.two_k_rounds, 2)}  UtilDmg:${padL(f.utility_damage, 5)}` +
        `  plants:${padL(f.plants, 2)} defuses:${padL(f.defuses, 2)}`,
    );
  }

  printWarnings(warnings);
  console.log('');
}

main().catch((e) => {
  console.error('\n✖ Parser threw:', e instanceof Error ? e.message : e);
  process.exit(1);
});
