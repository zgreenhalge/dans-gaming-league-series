import { isPlayedScore, parseScore } from './util';

export interface MatchPickBanInput {
  final_score: string | null;
  picked_map: string | null;
  shirts_pick: string | null;
  skins_starting_side: 'CT' | 'T' | null;
  shirts_stats: { is_win: boolean }[];
  skins_stats: { is_win: boolean }[];
}

export interface MapPickBanStat {
  map: string;
  picked: number;
  ctPicked: number;
  tPicked: number;
  pickedAndWon: number;
}

export interface PerSideStat {
  side: 'CT' | 'T';
  numTimesPicked: number;
  wins: number;
  losses: number;
}

function getWinningFaction(m: MatchPickBanInput): 'SHIRTS' | 'SKINS' | null {
  const shirtsWin = m.shirts_stats.some((s) => s.is_win);
  const skinsWin = m.skins_stats.some((s) => s.is_win);
  if (shirtsWin && !skinsWin) return 'SHIRTS';
  if (skinsWin && !shirtsWin) return 'SKINS';
  return null;
}

export function aggregateMapPickBanStats(matches: MatchPickBanInput[]): MapPickBanStat[] {
  const buckets = new Map<string, MatchPickBanInput[]>();

  for (const m of matches) {
    const effectiveMap = m.shirts_pick ?? m.picked_map;
    if (!isPlayedScore(m.final_score) || !effectiveMap) continue;
    const key = effectiveMap.trim().toLowerCase();
    const list = buckets.get(key) ?? [];
    list.push(m);
    buckets.set(key, list);
  }

  const out: MapPickBanStat[] = [];
  for (const [, matchList] of buckets) {
    const firstMatch = matchList[0];
    const display = ((firstMatch?.shirts_pick ?? firstMatch?.picked_map) ?? '') as string;
    let picked = 0;
    let ctPicked = 0;
    let tPicked = 0;
    let pickedAndWon = 0;

    for (const m of matchList) {
      picked++;

      if (m.skins_starting_side === 'CT') ctPicked++;
      else if (m.skins_starting_side === 'T') tPicked++;

      // shirts picked when shirts_pick is set; otherwise skins picked via picked_map
      const shirtsPicked = m.shirts_pick != null;
      const teamThatPicked = shirtsPicked ? 'SHIRTS' : 'SKINS';
      if (getWinningFaction(m) === teamThatPicked) pickedAndWon++;
    }

    out.push({ map: display, picked, ctPicked, tPicked, pickedAndWon });
  }

  return out.sort((a, b) => b.picked - a.picked);
}

export interface ScoreDistribution {
  ot: number;
  close: number;
  comfortable: number;
  landslide: number;
  total: number;
}

export function aggregateScoreDistribution(matches: MatchPickBanInput[]): ScoreDistribution {
  const out: ScoreDistribution = { ot: 0, close: 0, comfortable: 0, landslide: 0, total: 0 };
  for (const m of matches) {
    if (!isPlayedScore(m.final_score)) continue;
    const parsed = parseScore(m.final_score);
    if (!parsed) continue;
    const { shirts, skins } = parsed;
    const winner = Math.max(shirts, skins);
    const loser = Math.min(shirts, skins);
    const margin = winner - loser;
    out.total++;
    if (winner > 13) out.ot++;
    else if (margin <= 2) out.close++;
    else if (margin <= 4) out.comfortable++;
    else out.landslide++;
  }
  return out;
}

export function aggregatePerSideStats(matches: MatchPickBanInput[]): PerSideStat[] {
  const ct = { wins: 0, losses: 0 };
  const t = { wins: 0, losses: 0 };

  for (const m of matches) {
    if (!isPlayedScore(m.final_score) || !m.skins_starting_side) continue;

    // pickedSide = side chosen by the team that didn't pick the map
    const shirtsPicked = m.shirts_pick != null;
    const pickedSide = shirtsPicked
      ? m.skins_starting_side
      : (m.skins_starting_side === 'CT' ? 'T' : 'CT');

    const winner = getWinningFaction(m);
    // The team that picked this side is whichever team plays it
    // If skins starts on skins_starting_side and pickedSide === skins_starting_side → skins picked it
    const pickedBySkins = pickedSide === m.skins_starting_side;
    const sideTeamWon = pickedBySkins ? winner === 'SKINS' : winner === 'SHIRTS';

    const bucket = pickedSide === 'CT' ? ct : t;
    if (sideTeamWon) bucket.wins++;
    else if (winner) bucket.losses++;
  }

  return [
    { side: 'CT', numTimesPicked: ct.wins + ct.losses, wins: ct.wins, losses: ct.losses },
    { side: 'T', numTimesPicked: t.wins + t.losses, wins: t.wins, losses: t.losses },
  ];
}
