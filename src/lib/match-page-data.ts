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
 * The demo link and every played-match stat the tabs show. Only a played match has stats or a
 * replay, so those reads are skipped otherwise. The replay's events load whenever a job has ever run
 * (`status !== 'none'`), not only when `ready`, so a failed or in-flight regeneration never hides a
 * replay whose payload still exists — the Recap tab gates on the payload, not the status.
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
    // The H2H tab's per-pair damage bar — a match's own kill/damage exchange.
    played ? getMatchDamageEvents(matchId) : Promise.resolve([]),
    played ? getMatchWeaponClassStats(matchId) : Promise.resolve([]),
    played ? getMatchEconomyStats(matchId) : Promise.resolve([]),
    // The Economy sub-tab's round-by-round chart — per-round equipment value per player.
    played ? getMatchRoundEconomy(matchId) : Promise.resolve([]),
    played
      ? getReplayJobState(matchId).then(async (job) => ({
          job,
          events: job.status !== 'none' ? await getReplayEventsView(matchId) : null,
        }))
      : Promise.resolve({
          job: { status: 'none' as const, stage: null, ghRunUrl: null, errorMessage: null },
          events: null,
        }),
    // A demo recovered from several recordings (a server restart): the Recap tab doesn't offer replay
    // generation for it, since the replay only ever reads a single demo.
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
