"""
EHOG rating engine — shared computation and DB helpers.

Imported by:
  - ehog/backfill.py         (CLI full recompute)
  - api/ehog/recompute.py    (Vercel function, triggered after score submit)
"""

from __future__ import annotations

import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path

from openskill.models import PlackettLuce

# ---------------------------------------------------------------------------
# CONSTANTS — loaded from ehog/constants.json (single source of truth)
# ---------------------------------------------------------------------------

_CONSTANTS_PATH = Path(__file__).resolve().parent / "constants.json"
with open(_CONSTANTS_PATH) as _f:
    _C = json.load(_f)

FORMULA_VERSION: str = _C["FORMULA_VERSION"]
MU_DEFAULT: float = _C["MU_DEFAULT"]
SIGMA_DEFAULT: float = _C["SIGMA_DEFAULT"]
BETA: float = SIGMA_DEFAULT * _C["BETA_FACTOR"]
SEASON_REGRESSION: float = _C["SEASON_REGRESSION"]

EHOG_CENTER: float = _C["EHOG_CENTER"]
EHOG_SCALE: float = _C["EHOG_SCALE"]
EHOG_LAMBDA: float = _C["EHOG_LAMBDA"]

# σ dynamics
SIGMA_FLOOR: float = _C["SIGMA_FLOOR"]

MOV_M_MIN: float = _C["MOV_M_MIN"]
MOV_M_MAX: float = _C["MOV_M_MAX"]

BATCH_SIZE = 200

# ---------------------------------------------------------------------------
# EHOG TRANSFORM
# ---------------------------------------------------------------------------


def to_ehog(mu: float, sigma: float) -> float:
    """
    Symmetric logistic on skill = mu - LAMBDA*sigma, mapped to (10, 100).
    No clamp — the asymptote IS the bound.
    """
    skill = mu - EHOG_LAMBDA * sigma
    return 10.0 + 90.0 / (1.0 + math.exp(-(skill - EHOG_CENTER) / EHOG_SCALE))


# ---------------------------------------------------------------------------
# MARGIN-OF-VICTORY MULTIPLIER
# ---------------------------------------------------------------------------


def margin_multiplier(score_a: int, score_b: int) -> float:
    """
    Single per-match multiplier applied equally to all 4 players.
    Blowout → larger m → bigger update. Nailbiter → m ≈ M_MIN.
    """
    total = score_a + score_b
    if total <= 0:
        return 1.0
    margin_frac = abs(score_a - score_b) / total
    return MOV_M_MIN + (MOV_M_MAX - MOV_M_MIN) * margin_frac


# ---------------------------------------------------------------------------
# OPENSKILL MODEL
# ---------------------------------------------------------------------------

_model = PlackettLuce(beta=BETA)


def run_openskill_update(
    team_a_states: list[tuple[float, float]],
    team_b_states: list[tuple[float, float]],
    a_won: bool,
) -> tuple[list[tuple[float, float]], list[tuple[float, float]]]:
    """
    Unweighted PlackettLuce rate() over two 2-player teams.
    Returns (new_team_a_states, new_team_b_states) as (mu, sigma) tuples.
    """
    team_a = [_model.rating(mu=mu, sigma=sigma) for mu, sigma in team_a_states]
    team_b = [_model.rating(mu=mu, sigma=sigma) for mu, sigma in team_b_states]
    ranks = [0, 1] if a_won else [1, 0]
    new_a, new_b = _model.rate([team_a, team_b], ranks=ranks)
    return [(r.mu, r.sigma) for r in new_a], [(r.mu, r.sigma) for r in new_b]


# ---------------------------------------------------------------------------
# SCORE / SEASON HELPERS  (mirrors of src/lib/util.ts)
# ---------------------------------------------------------------------------

_PLAYED_SCORE_RE = re.compile(r"^\s*0\s*[-–]\s*0\s*$")


def is_played_score(final_score: str | None) -> bool:
    """Port of isPlayedScore(). False for None, empty, "0-0", or "0 – 0"."""
    if not final_score:
        return False
    return _PLAYED_SCORE_RE.match(final_score) is None


def extract_season_number(name: str) -> int | None:
    """Port of extractSeasonNumber(). Returns None for non-standard names."""
    m = re.search(r"Season\s+(\d+)", name, re.IGNORECASE)
    return int(m.group(1)) if m else None


# ---------------------------------------------------------------------------
# DB FETCHES
# ---------------------------------------------------------------------------

def fetch_all_season_numbers(sb) -> list[int]:
    """Returns all season numbers found in the seasons table, ascending."""
    rows = sb.table("seasons").select("name").execute().data
    numbers = {extract_season_number(r["name"]) for r in rows}
    return sorted(n for n in numbers if n is not None)


def fetch_player_names(sb) -> dict[int, str]:
    resp = sb.table("players").select("id, name").execute()
    return {row["id"]: row["name"] for row in resp.data}


def fetch_chronological_matches(
    sb,
    season_numbers: list[int],
    include_gauntlet: bool = True,
) -> list[dict]:
    """
    Ordered list of {match_id, season_number, is_gauntlet} for each played
    match, walking oldest→newest: season number → regular before paired
    gauntlet → week_number → match_number.
    """
    all_seasons = sb.table("seasons").select("id, name, is_gauntlet").execute().data

    season_map: dict[int, tuple[int, bool]] = {}
    for season_number in season_numbers:
        gauntlet_flags = [False] + ([True] if include_gauntlet else [])
        for is_gauntlet in gauntlet_flags:
            candidates = [
                s for s in all_seasons
                if s["is_gauntlet"] == is_gauntlet
                and extract_season_number(s["name"]) == season_number
            ]
            if not candidates:
                continue
            if len(candidates) > 1:
                raise ValueError(
                    f"Ambiguous season match for season {season_number}, "
                    f"is_gauntlet={is_gauntlet}: {[s['name'] for s in candidates]}"
                )
            season_map[candidates[0]["id"]] = (season_number, is_gauntlet)

    if not season_map:
        return []

    season_ids = list(season_map.keys())
    all_weeks = []
    for i in range(0, len(season_ids), BATCH_SIZE):
        chunk = season_ids[i: i + BATCH_SIZE]
        all_weeks.extend(
            sb.table("weeks")
            .select("id, season_id, week_number")
            .in_("season_id", chunk)
            .execute()
            .data
        )

    week_map: dict[int, tuple[int, int]] = {}
    week_ids = []
    for w in all_weeks:
        week_map[w["id"]] = (w["season_id"], w["week_number"])
        week_ids.append(w["id"])

    all_matches = []
    for i in range(0, len(week_ids), BATCH_SIZE):
        chunk = week_ids[i: i + BATCH_SIZE]
        all_matches.extend(
            sb.table("matches")
            .select("id, final_score, match_number, week_id")
            .in_("week_id", chunk)
            .execute()
            .data
        )

    def sort_key(m):
        wid = m["week_id"]
        sid, wn = week_map[wid]
        sn, ig = season_map[sid]
        return (sn, ig, wn, m["match_number"])

    all_matches.sort(key=sort_key)

    ordered = []
    for m in all_matches:
        if not is_played_score(m.get("final_score")):
            continue
        sid, _ = week_map[m["week_id"]]
        sn, ig = season_map[sid]
        ordered.append({
            "match_id": m["id"],
            "season_number": sn,
            "is_gauntlet": ig,
        })

    return ordered


def fetch_match_player_stats(sb, match_ids: list[int]) -> dict[int, list]:
    """Returns {match_id: [row, ...]} with per-player stats for each match."""
    by_match: dict[int, list] = {mid: [] for mid in match_ids}
    for i in range(0, len(match_ids), BATCH_SIZE):
        chunk = match_ids[i: i + BATCH_SIZE]
        resp = (
            sb.table("player_match_stats")
            .select(
                "match_id, player_id, faction, kills, assists, deaths, "
                "damage, adr, rounds_played, rounds_won, is_win"
            )
            .in_("match_id", chunk)
            .execute()
        )
        for row in resp.data:
            by_match[row["match_id"]].append(row)
    return by_match


# ---------------------------------------------------------------------------
# CORE RATING WALK
# ---------------------------------------------------------------------------

PlayerState = dict[int, tuple[float, float, float]]  # {player_id: (mu, sigma, ehog_rating)}


def compute_ratings(
    ordered_matches: list[dict],
    stats_by_match: dict[int, list],
    on_segment_end=None,
) -> tuple[list[dict], PlayerState, list[int]]:
    """
    Full chronological rating walk over ordered_matches.

    Returns (history_rows, player_state, zero_round_matches).
      history_rows      — one dict per (player, match), ready to upsert
      player_state      — {player_id: (mu, sigma, ehog_rating)} final state
      zero_round_matches — match IDs where total rounds == 0 (MoV defaulted)

    on_segment_end: optional callable(segment, player_state) fired after the
        last match in each segment, before inter-season regression is applied.
        segment is (season_number: int, is_gauntlet: bool).
    """
    player_state: PlayerState = {}
    zero_round_matches: list[int] = []
    history_rows: list[dict] = []
    current_segment = None

    def state_for(pid: int) -> tuple[float, float, float]:
        return player_state.get(pid, (MU_DEFAULT, SIGMA_DEFAULT, to_ehog(MU_DEFAULT, SIGMA_DEFAULT)))

    for sequence_index, entry in enumerate(ordered_matches, start=1):
        match_id = entry["match_id"]
        segment = (entry["season_number"], entry["is_gauntlet"])

        if segment != current_segment and current_segment is not None:
            if on_segment_end:
                on_segment_end(current_segment, player_state)
            prev_season, _ = current_segment
            cur_season, _ = segment
            if cur_season != prev_season:
                for pid, (mu, sigma, _) in player_state.items():
                    regressed_mu = mu + (MU_DEFAULT - mu) * SEASON_REGRESSION
                    regressed_sigma = max(SIGMA_FLOOR, sigma + (SIGMA_DEFAULT - sigma) * SEASON_REGRESSION)
                    player_state[pid] = (regressed_mu, regressed_sigma, to_ehog(regressed_mu, regressed_sigma))

        current_segment = segment
        rows = stats_by_match.get(match_id, [])

        if len(rows) != 4:
            print(f"  WARNING: match {match_id} has {len(rows)} player_match_stats rows, expected 4 — skipping")
            continue

        team_a_rows = [r for r in rows if r["faction"] == "SHIRTS"]
        team_b_rows = [r for r in rows if r["faction"] == "SKINS"]
        if len(team_a_rows) != 2 or len(team_b_rows) != 2:
            print(f"  WARNING: match {match_id} faction split is {len(team_a_rows)}/{len(team_b_rows)} — skipping")
            continue

        a_wins = {r["is_win"] for r in team_a_rows}
        b_wins = {r["is_win"] for r in team_b_rows}
        if len(a_wins) != 1 or len(b_wins) != 1 or a_wins == b_wins:
            print(f"  WARNING: match {match_id} has inconsistent/ambiguous is_win values — skipping")
            continue
        a_won = a_wins.pop()

        team_a_states = [state_for(r["player_id"])[:2] for r in team_a_rows]
        team_b_states = [state_for(r["player_id"])[:2] for r in team_b_rows]

        a_score = team_a_rows[0]["rounds_won"] or 0
        b_score = team_b_rows[0]["rounds_won"] or 0
        if (a_score + b_score) <= 0:
            zero_round_matches.append(match_id)

        # Unweighted update + explicit margin multiplier (μ-only)
        new_a_unweighted, new_b_unweighted = run_openskill_update(
            team_a_states, team_b_states, a_won
        )
        m = margin_multiplier(a_score, b_score)

        for rows_team, unweighted_states, prior_states in (
            (team_a_rows, new_a_unweighted, team_a_states),
            (team_b_rows, new_b_unweighted, team_b_states),
        ):
            for row, (uw_mu, uw_sigma), (prior_mu, prior_sigma) in zip(rows_team, unweighted_states, prior_states):
                pid = row["player_id"]
                _, _, prior_ehog = state_for(pid)

                new_mu = prior_mu + m * (uw_mu - prior_mu)
                new_sigma = max(SIGMA_FLOOR, uw_sigma)

                new_ehog = to_ehog(new_mu, new_sigma)
                rating_delta = new_ehog - prior_ehog

                history_rows.append({
                    "player_id": pid,
                    "match_id": match_id,
                    "sequence_index": sequence_index,
                    "skill_rating_weight": m,
                    "mu": new_mu,
                    "sigma": new_sigma,
                    "ehog_rating": new_ehog,
                    "rating_delta": rating_delta,
                    "formula_version": FORMULA_VERSION,
                    "computed_at": datetime.now(timezone.utc).isoformat(),
                })

                player_state[pid] = (new_mu, new_sigma, new_ehog)

    # Fire callback for the final segment
    if on_segment_end and current_segment is not None:
        on_segment_end(current_segment, player_state)

    return history_rows, player_state, zero_round_matches


# ---------------------------------------------------------------------------
# DB WRITES
# ---------------------------------------------------------------------------

def clear_ratings(sb) -> None:
    """
    Delete this version's history rows and null its column in player_current_ratings.
    Other versions' data is untouched.
    """
    sb.table("player_rating_history").delete().eq("formula_version", FORMULA_VERSION).execute()
    sb.table("player_current_ratings").update({FORMULA_VERSION: None}).neq("player_id", 0).execute()


def write_ratings(sb, history_rows: list[dict], player_state: PlayerState) -> None:
    """
    Upsert history rows and write this version's column in player_current_ratings.
    FORMULA_VERSION is used as the column name, so each version writes its own column.
    """
    for i in range(0, len(history_rows), BATCH_SIZE):
        chunk = history_rows[i: i + BATCH_SIZE]
        sb.table("player_rating_history").upsert(
            chunk, on_conflict="player_id,match_id,formula_version"
        ).execute()

    now_iso = datetime.now(timezone.utc).isoformat()
    for pid, (_, _, ehog_rating) in player_state.items():
        sb.table("player_current_ratings").upsert({
            "player_id": pid,
            FORMULA_VERSION: ehog_rating,
            "updated_at": now_iso,
        }, on_conflict="player_id").execute()
