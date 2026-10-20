// Web Worker entry for the fixed-length season planner: receives a roster and settings, replies
// with the `buildFormatPlan()` result. The planner is pure and deterministic for a seed, so the
// reply equals a main-thread call with the same input; only the thread differs.

import { buildFormatPlan, type FormatPlayer, type FormatResult, type SeasonFormatSettings } from './season-format';

export interface FormatWorkerRequest {
  players: FormatPlayer[];
  settings: SeasonFormatSettings;
}

self.onmessage = (e: MessageEvent<FormatWorkerRequest>) => {
  const result: FormatResult = buildFormatPlan(e.data.players, e.data.settings);
  self.postMessage(result);
};
