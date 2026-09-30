// Download the real-demo corpus (`src/lib/parsers/realDemos/corpus.json`) from R2 into the local
// fixture directory, plus a `<matchId>/inputs.json` per match carrying the roster/side/target the
// parsers need (read from the DB via `getReplayInputs`, so no Steam IDs are ever committed). Files
// already present are skipped; pass `--force` to re-download.
//
// The fixture directory is `DEMO_FIXTURE_DIR`, default `./.demo-fixtures` (gitignored).
// Needs CLOUDFLARE_R2_* plus NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.
//
// Usage:  npm run demo-fixtures:fetch [-- --force]

import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { r2, R2_BUCKET } from '../src/lib/r2';
import { getAdminClient } from '../src/lib/supabase-admin';
import { getReplayInputs } from '../src/lib/replay/inputs';
import { CORPUS, fixturePath, inputsPath, type FixtureInputs } from '../src/lib/parsers/realDemos/corpus';

const force = process.argv.includes('--force');

async function download(key: string): Promise<void> {
  const dest = fixturePath(key);
  if (!force && fs.existsSync(dest)) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const res = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  if (!res.Body) throw new Error(`R2 returned no body for ${key}`);
  const tmp = `${dest}.part`;
  await pipeline(res.Body as Readable, fs.createWriteStream(tmp));
  fs.renameSync(tmp, dest);
  console.log(`downloaded ${key}`);
}

async function main() {
  const supabase = getAdminClient();
  for (const entry of CORPUS) {
    await Promise.all(entry.keys.map(download));
    const dest = inputsPath(entry.matchId);
    if (force || !fs.existsSync(dest)) {
      const { roster, skinsSide, targetWinRounds } = await getReplayInputs(supabase, entry.matchId);
      const inputs: FixtureInputs = { roster, skinsSide, targetWinRounds };
      fs.writeFileSync(dest, JSON.stringify(inputs, null, 2));
      console.log(`wrote ${dest}`);
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
