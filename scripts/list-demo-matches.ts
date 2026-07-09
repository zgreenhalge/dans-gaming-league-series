// Enumerate the matches that have an uploaded demo in R2 (key `<matchId>/game.dem`),
// for the `replay-extract-all` batch workflow. Optionally narrows to matches that don't
// yet have a `replay.json` (set `ONLY_MISSING=true`) so a backfill can skip work that's
// already done. Writes a JSON array of match ids to `$GITHUB_OUTPUT` (`match_ids`), plus
// `count` and `has_matches` so the workflow can gate an empty matrix.
//
// Runs in the GitHub Action via `tsx`, reusing the same `src/lib/r2` client as the app.

import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { appendFileSync } from 'node:fs';
import { r2, R2_BUCKET, replayKey, listDemoMatchIds } from '../src/lib/r2';

const ONLY_MISSING = /^(1|true)$/i.test(process.env.ONLY_MISSING ?? '');

async function hasReplay(matchId: number): Promise<boolean> {
  try {
    await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: replayKey(matchId) }));
    return true;
  } catch {
    return false; // NoSuchKey (or any read error) → treat as missing
  }
}

async function main() {
  let ids = await listDemoMatchIds();
  if (ONLY_MISSING) {
    const checks = await Promise.all(ids.map(async (id) => ({ id, has: await hasReplay(id) })));
    ids = checks.filter((c) => !c.has).map((c) => c.id);
  }
  const json = JSON.stringify(ids);
  console.log(
    `Found ${ids.length} match(es) ${ONLY_MISSING ? 'missing a replay' : 'with a demo'}: ${json}`,
  );
  const out = process.env.GITHUB_OUTPUT;
  if (out) {
    appendFileSync(out, `match_ids=${json}\n`);
    appendFileSync(out, `count=${ids.length}\n`);
    appendFileSync(out, `has_matches=${ids.length > 0 ? 'true' : 'false'}\n`);
  }
}

main().catch((err) => {
  console.error(
    `::error::Failed to enumerate demo matches: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});
