// Inspect the raw event/property surface of a CS2 demo via demoparser2's own introspection
// helpers (list_game_events, list_updated_fields) plus raw event/tick samples — so a new stat
// can confirm the actual field name/shape/values it needs before a collector is written, instead
// of guessing from memory. See docs/demo-parsing-reference.md's guidance on this workflow.
//
// Read-only: no R2 writes, no DB writes, no session dependency.
//
// Usage:
//   tsx scripts/inspect-demo-fields.ts --match 123 --grep velocity,duck,crouch
//   tsx scripts/inspect-demo-fields.ts --demo ./game.dem --event player_hurt --count 5
//   tsx scripts/inspect-demo-fields.ts --match 123 --ticks weapon_fire --props m_vecVelocity,m_bDucked
//   tsx scripts/inspect-demo-fields.ts --match 123 --events
//
// Flags:
//   --demo <path>       local .dem file (gzip auto-detected). Mutually exclusive with --match.
//   --match <id>        pull the demo from R2 at demoKey(id) (needs CLOUDFLARE_R2_* env vars set).
//   --events            print every game event name present in the demo (list_game_events).
//   --grep <a,b,c>      print every list_updated_fields entry containing any of these
//                       comma-separated, case-insensitive substrings.
//   --event <name>      print --count raw rows of this game event, every field the parser has for it.
//   --count <n>         row count for --event (default 5).
//   --ticks <eventName> pull tick numbers from this event's occurrences (e.g. weapon_fire) and
//                       probe --props at those ticks with parseTicks. Prints the first --count
//                       matching rows, or the raw error if a prop name is invalid.
//   --props <a,b>       comma-separated wanted_props to probe with --ticks.

import { readFileSync } from 'node:fs';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { listGameEvents, listUpdatedFields, parseEvent, parseTicks } from '@laihoe/demoparser2';
import { r2, R2_BUCKET, demoKey } from '../src/lib/r2';
import { gunzipMaybe } from '../src/lib/gzip';

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

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const hasDemo = typeof args.demo === 'string';
  const hasMatch = typeof args.match === 'string';
  if (hasDemo === hasMatch) die('Provide exactly one of --demo <path> or --match <id>.');

  const rawBuf = hasDemo ? readFileSync(args.demo as string) : await loadDemoFromR2(Number(args.match));
  const demoBuffer = gunzipMaybe(rawBuf);
  console.log(`\n=== demo field inspection ===`);
  console.log(`source    : ${hasDemo ? `file ${args.demo}` : `R2 ${demoKey(Number(args.match))}`}`);
  console.log(`demo size : ${(demoBuffer.length / 1024 / 1024).toFixed(2)} MB\n`);

  if (args.events) {
    const events = listGameEvents(demoBuffer);
    console.log(`Game events (${Array.isArray(events) ? events.length : '?'}):`);
    console.log(events);
  }

  if (typeof args.grep === 'string') {
    const needles = (args.grep as string).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    const fields = listUpdatedFields(demoBuffer);
    const all: string[] = Array.isArray(fields) ? fields : Object.keys(fields ?? {});
    const matches = all.filter((f) => needles.some((n) => String(f).toLowerCase().includes(n)));
    console.log(`Fields matching [${needles.join(', ')}] (${matches.length}/${all.length} total):`);
    for (const m of matches) console.log(`  ${m}`);
  }

  if (typeof args.event === 'string') {
    const count = args.count ? Number(args.count) : 5;
    const rows = parseEvent(demoBuffer, args.event as string, [], []) as Record<string, unknown>[];
    console.log(`\n${args.event} — ${rows.length} total rows, showing first ${count}:`);
    for (const row of rows.slice(0, count)) console.log(row);
  }

  if (typeof args.ticks === 'string') {
    if (typeof args.props !== 'string') die('--ticks requires --props <a,b,c>.');
    const props = (args.props as string).split(',').map((s) => s.trim()).filter(Boolean);
    const count = args.count ? Number(args.count) : 5;
    const eventRows = parseEvent(demoBuffer, args.ticks as string, [], ['total_rounds_played']) as { tick: number }[];
    const sampleTicks = [...new Set(eventRows.map((r) => r.tick))].slice(0, count);
    console.log(`\nProbing props [${props.join(', ')}] at ${sampleTicks.length} tick(s) from "${args.ticks}":`);
    try {
      const rows = parseTicks(demoBuffer, props, sampleTicks);
      console.log(`✓ parseTicks succeeded — ${Array.isArray(rows) ? rows.length : '?'} row(s):`);
      for (const row of (rows as Record<string, unknown>[]).slice(0, count)) console.log(row);
    } catch (e) {
      console.log(`✖ parseTicks threw: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  console.log('');
}

main().catch((e) => {
  console.error('\n✖ Failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
