import { isPlayedScore, parseScore } from './util';

/**
 * The veto fields needed to classify a match's maps as picked/banned/no-picked — shared by every
 * map-stats surface (index, detail, statistics/season tabs, player pages) so "what counts as a
 * no-pick" is defined exactly once. Ban fields and `map_pool` are optional because gauntlet
 * matches carry neither (see docs/glossary.md's Veto entry) — they classify as "no bans, no
 * no-picks" rather than requiring every caller to fake the fields.
 */
export interface VetoFields {
  final_score: string | null;
  picked_map: string | null;
  shirts_pick: string | null;
  shirts_ban?: string | null;
  shirts_ban2?: string | null;
  skins_ban1?: string | null;
  skins_ban2?: string | null;
  is_playoff_game?: boolean;
  /** The match's season's regular-season map pool. Pass `null` for gauntlet seasons. */
  map_pool?: string[] | null;
}

export interface MapVetoOutcome {
  /** The effective played map(s) — `shirts_pick ?? picked_map`, trimmed, original casing. */
  picked: string[];
  /** Every map banned in this match's veto, trimmed, original casing. */
  banned: string[];
  /** Pool maps this match's veto never touched (pick or ban) — regular season, non-playoff only. */
  noPicked: string[];
}

/** Classifies a single match's maps into picked/banned/no-picked. Unplayed matches classify as
 *  empty across the board. */
export function classifyMatchVeto(m: VetoFields): MapVetoOutcome {
  if (!isPlayedScore(m.final_score)) return { picked: [], banned: [], noPicked: [] };

  const picked = Array.from(
    new Set([m.shirts_pick, m.picked_map].filter((v): v is string => !!v).map((v) => v.trim())),
  );
  const banned = [m.shirts_ban, m.shirts_ban2, m.skins_ban1, m.skins_ban2]
    .filter((v): v is string => !!v)
    .map((v) => v.trim());

  let noPicked: string[] = [];
  if (!m.is_playoff_game && picked.length > 0 && m.map_pool && m.map_pool.length > 0) {
    const touched = new Set([...picked, ...banned].map((v) => v.toLowerCase()));
    noPicked = m.map_pool.map((v) => v.trim()).filter((v) => v && !touched.has(v.toLowerCase()));
  }

  return { picked, banned, noPicked };
}

export interface MatchPickBanInput extends VetoFields {
  skins_starting_side: 'CT' | 'T' | null;
  shirts_stats: { is_win: boolean }[];
  skins_stats: { is_win: boolean }[];
}

export interface MapPickBanStat {
  map: string;
  picked: number;
  banned: number;
  noPicked: number;
  ctPicked: number;
  tPicked: number;
  pickedAndWon: number;
  avgRounds: number;
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

interface MapPickBanBucket {
  display: string;
  picked: number;
  banned: number;
  noPicked: number;
  ctPicked: number;
  tPicked: number;
  pickedAndWon: number;
  totalRounds: number;
}

function emptyBucket(display: string): MapPickBanBucket {
  return { display, picked: 0, banned: 0, noPicked: 0, ctPicked: 0, tPicked: 0, pickedAndWon: 0, totalRounds: 0 };
}

export function aggregateMapPickBanStats(matches: MatchPickBanInput[]): MapPickBanStat[] {
  const buckets = new Map<string, MapPickBanBucket>();
  const getBucket = (name: string): MapPickBanBucket => {
    const key = name.toLowerCase();
    let b = buckets.get(key);
    if (!b) {
      b = emptyBucket(name);
      buckets.set(key, b);
    }
    return b;
  };

  for (const m of matches) {
    const { picked, banned, noPicked } = classifyMatchVeto(m);

    for (const name of picked) {
      const b = getBucket(name);
      b.picked++;

      if (m.skins_starting_side === 'CT') b.ctPicked++;
      else if (m.skins_starting_side === 'T') b.tPicked++;

      // shirts picked when shirts_pick is set; otherwise skins picked via picked_map
      const shirtsPicked = m.shirts_pick != null;
      const teamThatPicked = shirtsPicked ? 'SHIRTS' : 'SKINS';
      if (getWinningFaction(m) === teamThatPicked) b.pickedAndWon++;

      const parsed = parseScore(m.final_score);
      if (parsed) b.totalRounds += parsed.shirts + parsed.skins;
    }

    for (const name of banned) getBucket(name).banned++;
    for (const name of noPicked) getBucket(name).noPicked++;
  }

  return Array.from(buckets.values())
    .map(({ display, picked, banned, noPicked, ctPicked, tPicked, pickedAndWon, totalRounds }) => ({
      map: display,
      picked,
      banned,
      noPicked,
      ctPicked,
      tPicked,
      pickedAndWon,
      avgRounds: picked > 0 ? totalRounds / picked : 0,
    }))
    .sort((a, b) => b.picked - a.picked);
}

export interface ScoreDistribution {
  crazy: number;
  close: number;
  competitive: number;
  convincing: number;
  crushed: number;
  total: number;
}

// Buckets are keyed on the losing team's round count. Overtime (winner > 13)
// is its own "crazy" bucket, checked before the loser-round buckets.
export function aggregateScoreDistribution(matches: MatchPickBanInput[]): ScoreDistribution {
  const out: ScoreDistribution = { crazy: 0, close: 0, competitive: 0, convincing: 0, crushed: 0, total: 0 };
  for (const m of matches) {
    if (!isPlayedScore(m.final_score)) continue;
    const parsed = parseScore(m.final_score);
    if (!parsed) continue;
    const { shirts, skins } = parsed;
    const winner = Math.max(shirts, skins);
    const loser = Math.min(shirts, skins);
    out.total++;
    if (winner > 13) out.crazy++;
    else if (loser <= 3) out.crushed++;
    else if (loser <= 6) out.convincing++;
    else if (loser <= 9) out.competitive++;
    else out.close++;
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

// ─── Player-perspective stat interfaces & aggregators ───────────────────────

export interface PlayerMatchInput extends VetoFields {
  map: string | null;
  faction: 'SHIRTS' | 'SKINS';
  skins_starting_side: 'CT' | 'T' | null;
  is_win: boolean;
  rounds_won: number;
  rounds_played: number;
}

export interface PlayerMapStat {
  map: string;
  games: number;
  wins: number;
  picked: number;
  banned: number;
  noPicked: number;
  ctPlayed: number;
  tPlayed: number;
  pickedAndWon: number;
  avgRounds: number;
}

export interface PlayerSideStat {
  side: 'CT' | 'T';
  played: number;
  numTimesPicked: number;
  wins: number;
  losses: number;
  roundsWon: number;
  roundsPlayed: number;
}

interface PlayerMapBucket {
  display: string;
  games: number;
  wins: number;
  picked: number;
  banned: number;
  noPicked: number;
  ctPlayed: number;
  tPlayed: number;
  pickedAndWon: number;
  totalRounds: number;
}

/**
 * Per-map stats from one player's own match history — games/wins/picked/side are scoped to maps
 * the player actually played, but banned/no-picked reflect the veto activity of every match the
 * player was in, including maps their side never got to play (banned before pick, or left in the
 * pool untouched).
 */
export function aggregatePlayerMapStats(matches: PlayerMatchInput[]): PlayerMapStat[] {
  const buckets = new Map<string, PlayerMapBucket>();
  const getBucket = (name: string): PlayerMapBucket => {
    const key = name.toLowerCase();
    let b = buckets.get(key);
    if (!b) {
      b = { display: name, games: 0, wins: 0, picked: 0, banned: 0, noPicked: 0, ctPlayed: 0, tPlayed: 0, pickedAndWon: 0, totalRounds: 0 };
      buckets.set(key, b);
    }
    return b;
  };

  for (const m of matches) {
    if (isPlayedScore(m.final_score) && m.map) {
      const b = getBucket(m.map.trim());

      b.games++;
      if (m.is_win) b.wins++;
      b.totalRounds += m.rounds_played;

      const playerPicked = m.faction === 'SHIRTS' ? m.shirts_pick != null : m.picked_map != null;
      if (playerPicked) b.picked++;

      if (m.skins_starting_side) {
        const playerSide = m.faction === 'SKINS' ? m.skins_starting_side : (m.skins_starting_side === 'CT' ? 'T' : 'CT');
        if (playerSide === 'CT') b.ctPlayed++;
        else b.tPlayed++;
      }

      if (playerPicked && m.is_win) b.pickedAndWon++;
    }

    const { banned, noPicked } = classifyMatchVeto(m);
    for (const name of banned) getBucket(name).banned++;
    for (const name of noPicked) getBucket(name).noPicked++;
  }

  return Array.from(buckets.values())
    .map(({ display, games, wins, picked, banned, noPicked, ctPlayed, tPlayed, pickedAndWon, totalRounds }) => ({
      map: display,
      games,
      wins,
      picked,
      banned,
      noPicked,
      ctPlayed,
      tPlayed,
      pickedAndWon,
      avgRounds: games > 0 ? totalRounds / games : 0,
    }))
    .sort((a, b) => b.games - a.games);
}

export function aggregatePlayerSideStats(matches: PlayerMatchInput[]): PlayerSideStat[] {
  const ct = { played: 0, numTimesPicked: 0, wins: 0, losses: 0, roundsWon: 0, roundsPlayed: 0 };
  const t = { played: 0, numTimesPicked: 0, wins: 0, losses: 0, roundsWon: 0, roundsPlayed: 0 };

  for (const m of matches) {
    if (!isPlayedScore(m.final_score) || !m.skins_starting_side) continue;
    const playerSide = m.faction === 'SKINS' ? m.skins_starting_side : (m.skins_starting_side === 'CT' ? 'T' : 'CT');
    const bucket = playerSide === 'CT' ? ct : t;
    bucket.played++;
    bucket.roundsWon += m.rounds_won;
    bucket.roundsPlayed += m.rounds_played;
    if (m.is_win) bucket.wins++;
    else bucket.losses++;

    const playerTeamChoseSide = m.faction === 'SHIRTS' ? m.picked_map != null : m.shirts_pick != null;
    if (playerTeamChoseSide) bucket.numTimesPicked++;
  }

  return [
    { side: 'CT', ...ct },
    { side: 'T', ...t },
  ];
}
