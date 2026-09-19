// Dumps a CS2 demo's raw round_end stream — tick, engine round number, winner, warmup flag, reason,
// and each player's team_num sampled at that round's end tick — plus parsePlayerInfo() and every
// begin_new_match tick. Unlike scripts/inspect-demo.ts (which runs the production parsers and
// prints their derived output), this prints the unprocessed per-round facts those parsers are built
// from, for hand-verifying round continuity, half/OT swap timing, or a starting side directly
// against the demo — e.g. before trusting a parser's output on a demo with unusual round shape
// (a restart, a truncated file, an ambiguous half-swap).
//
// Read-only: no R2 writes, no DB writes, no session dependency.
//
// Usage:
//   tsx scripts/inspect-demo-rounds.ts --demo ./game.dem
//   tsx scripts/inspect-demo-rounds.ts --match 123
//
// Flags:
//   --demo <path>   local .dem file (gzip auto-detected). Mutually exclusive with --match.
//   --match <id>    pull the demo from R2 at demoKey(id) (needs CLOUDFLARE_R2_* env vars set).

import { readFileSync } from 'node:fs';
import { parseEvent, parsePlayerInfo, parseTicks } from '@laihoe/demoparser2';
import { gunzipMaybe } from '../src/lib/gzip';
import { parseArgs, die, loadDemoFromR2 } from './inspect-demo-shared';

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.demo && !args.match) die('Pass --demo <path> or --match <id>.');
  if (args.demo && args.match) die('--demo and --match are mutually exclusive.');

  const buf = gunzipMaybe(
    args.demo ? readFileSync(String(args.demo)) : await loadDemoFromR2(Number(args.match)),
  );

  const players: { steamid: string | bigint; name: string }[] = parsePlayerInfo(buf);
  console.log(
    `parsePlayerInfo(): ${players.length} players`,
    players.map((p) => `${p.name}(${p.steamid})`),
  );

  const begins: { tick: number }[] = parseEvent(buf, 'begin_new_match');
  console.log(
    'begin_new_match ticks:',
    begins.map((e) => e.tick).sort((a, b) => a - b),
  );

  const rounds: {
    tick: number;
    total_rounds_played: number;
    winner: string | null;
    reason: string | null;
    is_warmup_period: boolean | number;
  }[] = parseEvent(buf, 'round_end', [], [
    'total_rounds_played', 'winner', 'reason', 'is_warmup_period',
  ]);

  console.log(`round_end events (${rounds.length}):`);
  for (const r of [...rounds].sort((a, b) => a.tick - b.tick)) {
    console.log(
      `  tick=${r.tick}  total_rounds_played=${r.total_rounds_played}` +
      `  winner=${r.winner}  warmup=${r.is_warmup_period}  reason=${r.reason}`,
    );

    const teamRows = parseTicks(buf, ['team_num'], [r.tick]) as {
      steamid: string | bigint;
      team_num?: number;
    }[];
    const teams = teamRows
      .filter((t) => t.steamid && String(t.steamid) !== '0')
      .map((t) => `${t.steamid}:${t.team_num}`)
      .join(', ');
    console.log(`    team_num @ tick=${r.tick}: ${teams}`);
  }
}

main();
