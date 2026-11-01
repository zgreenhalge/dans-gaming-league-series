// The per-match data a match page's score header and stat tabs render, shared by the league match page
// (`/matches/[id]`) and the scrim match page (`/scrims/matches/[id]`) so the two can't drift on what a
// match shows. Everything here is keyed by match id alone — nothing about seasons, weeks or scrim
// nights — which is what lets both kinds of match use it.

import { HeadObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { r2, R2_BUCKET, demoKey } from './r2';
import { getDemoManifest } from './demo/segmentManifest';
import {
  getMatchSabremetrics,
  getMatchKills,
  getMatchDamageEvents,
  getMatchWeaponClassStats,
  getMatchEconomyStats,
  getMatchRoundEconomy,
  getReplayJobState,
  getReplayEventsView,
} from './queries';

/** The side SHIRTS start on, from SKINS' (`null` when neither is known). */
export function shirtsFaction(skinsSide: 'CT' | 'T' | null): 'CT' | 'T' | null {
  if (skinsSide === 'CT') return 'T';
  if (skinsSide === 'T') return 'CT';
  return null;
}

/** A played match's MVP: the highest per-match ADR among players who played a round. */
export function matchMvpPlayerId(stats: { player_id: number; adr: number; rounds_played: number }[], played: boolean): number | null {
  if (!played) return null;
  const [top] = stats.filter((s) => s.rounds_played > 0).sort((a, b) => b.adr - a.adr);
  return top?.player_id ?? null;
}

/**
 * The demo link and every played-match stat the tabs show, all in one parallel batch. Only a played
 * match has stats or a replay, and the Recap tab is gated on `played`, so those reads are skipped
 * otherwise.
 */
export async function loadMatchPageFacts(matchId: number, played: boolean) {
  const key = demoKey(matchId);
  const [
    demoDownloadUrl,
    sabremetrics,
    matchKills,
    matchDamageEvents,
    matchWeaponClassStats,
    matchEconomyStats,
    matchRoundEconomy,
    replay,
    isMultiSegmentDemo,
  ] = await Promise.all([
    r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }))
      .then(() => getSignedUrl(r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }), { expiresIn: 3600 }))
      .catch(() => null),
    played ? getMatchSabremetrics(matchId) : Promise.resolve([]),
    played ? getMatchKills(matchId) : Promise.resolve([]),
    // Feeds the H2H tab's per-pair damage bar (#461) — a match's own kill/damage exchange, not
    // each player's own damage total (`player_match_stats.damage`).
    played ? getMatchDamageEvents(matchId) : Promise.resolve([]),
    played ? getMatchWeaponClassStats(matchId) : Promise.resolve([]),
    played ? getMatchEconomyStats(matchId) : Promise.resolve([]),
    // Feeds the Economy sub-tab's round-by-round chart (#519) — per-round equipment value per
    // player, distinct from `matchEconomyStats`'s tier-bucketed aggregate above.
    played ? getMatchRoundEconomy(matchId) : Promise.resolve([]),
    // Replay/Events (issue #121), chained rather than a second query: the events lookup needs the
    // job's own status first. Status is defensive (tolerates missing DB columns). The events payload
    // loads whenever a job has ever run (status !== 'none'), NOT only when status === 'ready', so a
    // failed/in-flight *re*generation never hides a replay whose payload still exists in R2 — the
    // Recap tab gates on the payload, not the status flag.
    played
      ? getReplayJobState(matchId).then(async (job) => ({
          job,
          events: job.status !== 'none' ? await getReplayEventsView(matchId) : null,
        }))
      : Promise.resolve({
          job: { status: 'none' as const, stage: null, ghRunUrl: null, errorMessage: null },
          events: null,
        }),
    // Whether this match's demo was recovered from multiple recordings (a server restart) — the
    // Recap tab uses this to skip offering replay generation, which only ever reads a single demo
    // and would just fail or produce a one-segment replay for a match like this.
    played ? getDemoManifest(matchId).then((m) => !!m).catch(() => false) : Promise.resolve(false),
  ]);
  return {
    demoDownloadUrl,
    sabremetrics,
    matchKills,
    matchDamageEvents,
    matchWeaponClassStats,
    matchEconomyStats,
    matchRoundEconomy,
    replayJob: replay.job,
    replayEvents: replay.events,
    isMultiSegmentDemo,
  };
}
