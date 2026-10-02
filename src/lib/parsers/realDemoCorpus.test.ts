/**
 * Runs the production parsers (`parseDemoFile` + `parseDemoSabremetrics`, and their `*Segments`
 * variants) against real demos from the corpus and asserts checkDemoParseInvariants() holds for each
 * — the same code path `scripts/demo-ingest.ts` runs, minus R2/DB/Discord. Demos are fetched by
 * `npm run demo-fixtures:fetch` into a gitignored directory (see realDemos/corpus.ts); a corpus entry
 * whose files are absent is skipped, so a plain checkout's `npm test` stays green and offline.
 *
 * Run:  npm run demo-fixtures:fetch && npx vitest run src/lib/parsers/realDemoCorpus.test.ts
 */

import fs from 'node:fs';
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { parseDemoBuffers } from '../demo/parseDemo';
import { gunzipMaybe } from '../gzip';
import { parseScore } from '../util';
import { checkDemoParseInvariants } from './demoInvariants';
import { CORPUS, fixturePath, hasFixture, loadInputs } from './realDemos/corpus';

const PARSE_TIMEOUT_MS = 120_000;

describe('real-demo corpus', () => {
  for (const entry of CORPUS) {
    it.skipIf(!hasFixture(entry))(
      `match ${entry.matchId}: ${entry.shape}`,
      () => {
        const { roster, skinsSide, targetWinRounds } = loadInputs(entry);
        const buffers = entry.keys.map((k) => gunzipMaybe(fs.readFileSync(fixturePath(k))));
        const { parsed, sab } = parseDemoBuffers(buffers, roster, skinsSide, targetWinRounds);

        const score = parseScore(entry.expectedScore)!;
        const violations = checkDemoParseInvariants(parsed, sab, { ...score, rounds: entry.expectedRounds });
        assert.deepEqual(violations, []);
      },
      PARSE_TIMEOUT_MS,
    );
  }
});
