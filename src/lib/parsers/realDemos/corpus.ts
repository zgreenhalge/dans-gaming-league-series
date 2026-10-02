/**
 * The real-demo corpus: which R2 demos the parsers are exercised against, and the
 * confirmed outcome each one must reproduce. The demo files themselves are far too large to commit
 * (tens to hundreds of MB), so `corpus.json` lists them by R2 key and `scripts/fetch-demo-fixtures.ts`
 * downloads them into `FIXTURE_DIR` (gitignored), alongside a `<matchId>/inputs.json` carrying the
 * roster/side/target the parsers need. `corpus.json` holds no Steam IDs — the roster is read from
 * the DB at fetch time.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { ReplayInputs } from '../../replay/inputs';
import corpusJson from './corpus.json';

export interface CorpusEntry {
  matchId: number;
  /** R2 keys, in segment order — one for a single recording, several for a restart-split match. */
  keys: string[];
  /** The demo shape this entry covers; what makes it worth having in the corpus. */
  shape: string;
  /** The match's confirmed `final_score` (`shirts-skins`). */
  expectedScore: string;
  /** The match's confirmed live round count (`match_rounds` row count). */
  expectedRounds: number;
}

/** What the parsers need besides the demo bytes — the slice of `ReplayInputs` they read. */
export type FixtureInputs = Pick<ReplayInputs, 'roster' | 'skinsSide' | 'targetWinRounds'>;

export const CORPUS = corpusJson as CorpusEntry[];

export const FIXTURE_DIR = process.env.DEMO_FIXTURE_DIR ?? path.join(process.cwd(), '.demo-fixtures');

/** Local path for an R2 key inside `FIXTURE_DIR` (keys are `<matchId>/<file>`). */
export function fixturePath(key: string): string {
  return path.join(FIXTURE_DIR, key);
}

export function inputsPath(matchId: number): string {
  return path.join(FIXTURE_DIR, String(matchId), 'inputs.json');
}

/** True when every demo file and the inputs file for `entry` are present locally. */
export function hasFixture(entry: CorpusEntry): boolean {
  return fs.existsSync(inputsPath(entry.matchId)) && entry.keys.every((k) => fs.existsSync(fixturePath(k)));
}

export function loadInputs(entry: CorpusEntry): FixtureInputs {
  return JSON.parse(fs.readFileSync(inputsPath(entry.matchId), 'utf8')) as FixtureInputs;
}
