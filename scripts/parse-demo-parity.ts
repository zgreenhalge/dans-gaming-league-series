// Phase-0 parity harness for the DatHost + MatchZy spike (see
// `dathost_handoff/DATHOST_PHASE0_PLAN.md`). Runs the *exact* production parsers
// (`parseDemoFile` + `parseDemoSabremetrics`) against a real MatchZy `.dem`, with a hand-built
// roster and a known starting side — mirroring `POST /api/matches/[id]/demo/parse` but with **no
// Supabase or session dependency**. Prints a diff-friendly report so its numbers can be checked
// against the in-game scoreboard and MatchZy's `matchzy_get_match_stats` CSV / `map_result`.
//
// This is a throwaway spike tool, not part of the app runtime. It writes nothing (no R2, no DB).
//
// Usage:
//   tsx scripts/parse-demo-parity.ts --demo ./game.dem --roster ./roster.json --skins-side CT
//   tsx scripts/parse-demo-parity.ts --match 123 --roster ./roster.json   # pulls demo from R2
//   tsx scripts/parse-demo-parity.ts --demo ./game.dem --roster ./roster.json --skins-side unknown
//                                                       # exercises the manual-score warning path
//
// Flags:
//   --demo <path>        local .dem file (gzip auto-detected). Mutually exclusive with --match.
//   --match <id>         pull the demo from R2 at demoKey(id) (needs CLOUDFLARE_R2_* env).
//   --roster <path>      REQUIRED. JSON array of RosterEntry:
//                          [{ "player_id": 1, "faction": "SHIRTS",
//                             "steam_id": "7656119...", "name": "Zach",
//                             "steam_nickname": "zg" }, ...]
//                        steam_id must match the demo's accounts; name/steam_nickname are display.
//   --skins-side CT|T|unknown   default "unknown" → passes null (no score derived; warning fires).
//   --target <n>         target win rounds (default 13).
//   --json               print the full raw parser output as JSON instead of the readable report.

import { readFileSync } from 'node:fs';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { parseDemoFile, type RosterEntry, type DemoPlayerStat } from '../src/lib/demoParser';
import { parseDemoSabremetrics } from '../src/lib/demoOrchestrator';
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

  if (!args.roster || typeof args.roster !== 'string') {
    die('Missing --roster <path.json> (hand-built RosterEntry[]). See the header for the shape.');
  }
  const hasDemo = typeof args.demo === 'string';
  const hasMatch = typeof args.match === 'string';
  if (hasDemo === hasMatch) {
    die('Provide exactly one of --demo <path> or --match <id>.');
  }

  // Roster
  let roster: RosterEntry[];
  try {
    roster = JSON.parse(readFileSync(args.roster as string, 'utf8')) as RosterEntry[];
  } catch (e) {
    die(`Could not read/parse roster JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!Array.isArray(roster) || roster.length === 0) die('Roster JSON must be a non-empty array.');

  // Side
  const sideRaw = (typeof args['skins-side'] === 'string' ? args['skins-side'] : 'unknown')
    .toString()
    .toUpperCase();
  let skinsSide: 'CT' | 'T' | null;
  if (sideRaw === 'CT') skinsSide = 'CT';
  else if (sideRaw === 'T') skinsSide = 'T';
  else if (sideRaw === 'UNKNOWN') skinsSide = null;
  else die(`--skins-side must be CT, T, or unknown (got "${sideRaw}").`);

  const targetWinRounds = args.target ? Number(args.target) : 13;
  if (!Number.isFinite(targetWinRounds) || targetWinRounds <= 0) die('--target must be a positive number.');

  // Demo bytes
  const rawBuf = hasDemo
    ? readFileSync(args.demo as string)
    : await loadDemoFromR2(Number(args.match));
  const demoBuffer = gunzipMaybe(rawBuf);

  console.log('\n=== Phase-0 parser parity harness ===');
  console.log(`source        : ${hasDemo ? `file ${args.demo}` : `R2 ${demoKey(Number(args.match))}`}`);
  console.log(`demo size     : ${(demoBuffer.length / 1024 / 1024).toFixed(2)} MB`);
  console.log(`roster        : ${roster.length} players`);
  console.log(`skins side    : ${skinsSide ?? 'unknown (null → score not derived, expect a warning)'}`);
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
  console.log(
    `\nScore (derived): SHIRTS ${result.shirts_score ?? '—'}  vs  SKINS ${result.skins_score ?? '—'}`,
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
  console.log('\nDiff these numbers against the in-game scoreboard + MatchZy CSV / map_result.\n');
}

main().catch((e) => {
  console.error('\n✖ Parser threw:', e instanceof Error ? e.message : e);
  process.exit(1);
});
