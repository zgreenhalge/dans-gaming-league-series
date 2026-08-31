// TEMPORARY — ground-truth check for the #491 damage side-split investigation. Prints round_end's
// own `total_rounds_played` alongside the `total_rounds_played` player_hurt events report for ticks
// inside that round's window, to verify the +1 relationship roundOf() (parsers/_shared.ts) assumes
// between a round_end event's own counter and what a mid-round event sees. Delete before merging.
//
// Needs Cloudflare R2 creds in env:
//   set -a; . ./.env.local; set +a
//   tsx scripts/dump-round-boundary-ticks.ts --match 71

import { parseEvent } from '@laihoe/demoparser2';
import { gunzipMaybe } from '../src/lib/gzip';
import { parseArgs, die, loadDemoFromR2 } from './inspect-demo-shared';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args.match !== 'string') die('Usage: tsx scripts/dump-round-boundary-ticks.ts --match <id>');
  const matchId = Number(args.match);

  const rawBuf = await loadDemoFromR2(matchId);
  const demoBuffer = gunzipMaybe(rawBuf);

  const roundEndRows = parseEvent(demoBuffer, 'round_end', [], [
    'total_rounds_played', 'winner', 'is_warmup_period',
  ]) as { tick: number; total_rounds_played: number; winner: string | null; is_warmup_period: boolean | number }[];

  const hurtRows = parseEvent(demoBuffer, 'player_hurt', [], ['total_rounds_played']) as {
    tick: number;
    total_rounds_played: number;
  }[];
  hurtRows.sort((a, b) => a.tick - b.tick);

  const liveRounds = roundEndRows
    .filter((e) => !e.is_warmup_period && e.winner !== null && e.total_rounds_played > 0)
    .sort((a, b) => a.tick - b.tick);

  console.log(`\n=== round boundary ticks: match ${matchId} ===`);
  console.log(`live round_end events: ${liveRounds.length}`);
  console.log(`player_hurt events   : ${hurtRows.length}\n`);

  console.log(`round_end#  round_end.tick  round_end.total_rounds_played  |  hurt events in this round's window (tick < round_end.tick, tick >= prev round_end.tick)`);
  let prevEndTick = -Infinity;
  for (let i = 0; i < liveRounds.length; i++) {
    const r = liveRounds[i];
    const inWindow = hurtRows.filter((h) => h.tick > prevEndTick && h.tick <= r.tick);
    const trpValues = [...new Set(inWindow.map((h) => h.total_rounds_played))];
    console.log(
      `${String(i + 1).padStart(10)}  ${String(r.tick).padStart(14)}  ${String(r.total_rounds_played).padStart(29)}  |  ` +
        `n=${inWindow.length}, hurt.total_rounds_played values=[${trpValues.join(',')}]`,
    );
    prevEndTick = r.tick;
  }
  console.log('');
}

main().catch((e) => {
  console.error('✖', e instanceof Error ? e.message : e);
  process.exit(1);
});
