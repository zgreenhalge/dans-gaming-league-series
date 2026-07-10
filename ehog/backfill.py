"""
DGLS EHOG Rating Backfill — full chronological recompute for Seasons 1–N.

Reads all played matches from Supabase in order, runs the rating walk, then
clears and rewrites player_rating_history + players.ehog_rating.

Use --dry-run to compute and print standings without touching the DB.
Use --calibration to instead score pre-match win predictions against actual outcomes
(Brier score + reliability bands) — a dry-run-only analysis mode, never writes to the DB.
Add --grid to --calibration to sweep MOV_M_MIN/MOV_M_MAX/EHOG_SCALE/EHOG_LAMBDA and print
Brier per combination.

See ehog/engine.py for the rating math.
See ehog_handoff/schema.sql for the required DB migration.

Setup:
  pip install supabase openskill python-dotenv
  python ehog/backfill.py --dry-run
  python ehog/backfill.py
  python ehog/backfill.py --calibration
  python ehog/backfill.py --calibration --grid
"""

import os
import sys
import argparse
from pathlib import Path

# Repo root on sys.path so `ehog.engine` is importable without installation.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent / ".env.local")
except ImportError:
    pass

from supabase import create_client

import ehog.engine as engine
from ehog.engine import (
    fetch_chronological_matches,
    fetch_match_player_stats,
    fetch_player_names,
    fetch_player_seeds,
    compute_ratings,
    clear_ratings,
    write_ratings,
)

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL") or ""
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or ""
DEFAULT_SEASON_NUMBERS = [1, 2, 3]

# --calibration: baseline Brier score for "always predict 50%" — the number to beat.
BASELINE_BRIER = 0.25

# --grid: sweep ranges. MOV_M_MIN/MOV_M_MAX feed the margin-of-victory multiplier that shapes
# mu/sigma evolution, so they can move the Brier score. EHOG_SCALE/EHOG_LAMBDA only reshape the
# mu/sigma -> display-rating transform and never touch predict_win's raw mu/sigma inputs — they
# are included because the issue asks for them, but expect their columns to be flat.
GRID_MOV_M_MIN = [0.3, 0.5, 0.7]
GRID_MOV_M_MAX = [1.0, 1.3, 1.6]
GRID_EHOG_SCALE = [5.0, 7.0]
GRID_EHOG_LAMBDA = [0.0, 0.3]


def print_standings(label: str, player_state: dict, player_names: dict[int, str]) -> None:
    print(f"\n{'─' * 60}")
    print(f"  {label}")
    print(f"{'─' * 60}")
    print(f"  {'#':>2}  {'name':<20s}  {'mu':>7}  {'sigma':>6}  {'EHOG':>7}")
    ranked = sorted(player_state.items(), key=lambda kv: kv[1][2], reverse=True)
    for rank, (pid, (mu, sigma, ehog)) in enumerate(ranked, start=1):
        name = player_names.get(pid, f"id={pid}")
        print(f"  #{rank:2d}  {name:<20s}  {mu:>7.3f}  {sigma:>6.3f}  {ehog:>7.3f}")


def run_calibration(ordered_matches: list[dict], stats_by_match: dict, player_seeds: dict) -> list[tuple[int, float, int]]:
    """
    Chronological replay recording (match_id, p_shirts_win, outcome) from pre-match ratings —
    outcome is 1 if SHIRTS won, 0 otherwise. Never writes to the DB.
    """
    records: list[tuple[int, float, int]] = []

    def on_before_match(match_id, team_a_states, team_b_states, a_won):
        p = engine.predict_win(team_a_states, team_b_states)
        records.append((match_id, p, 1 if a_won else 0))

    compute_ratings(ordered_matches, stats_by_match, player_seeds=player_seeds, on_before_match=on_before_match)
    return records


def brier_score(records: list[tuple[int, float, int]]) -> float:
    return sum((p - outcome) ** 2 for _, p, outcome in records) / len(records)


def print_reliability_bands(records: list[tuple[int, float, int]]) -> None:
    """
    Buckets by predicted confidence (folding p<0.5 by symmetry — "predicted 30%" and "predicted
    70%" both land in the 70-80% band once reframed as "confidence in the favored side").
    """
    bands = [(0.5, 0.6), (0.6, 0.7), (0.7, 0.8), (0.8, 0.9), (0.9, 1.0 + 1e-9)]
    print(f"\n  {'band':>10}  {'n':>5}  {'mean p':>8}  {'actual win%':>12}")
    for lo, hi in bands:
        confidences = []
        favored_wins = []
        for _, p, outcome in records:
            conf = max(p, 1 - p)
            if lo <= conf < hi:
                confidences.append(conf)
                favored_wins.append(outcome if p >= 0.5 else 1 - outcome)
        n = len(confidences)
        if n == 0:
            continue
        mean_p = sum(confidences) / n
        actual = sum(favored_wins) / n
        label = f"{int(lo * 100)}-{int(min(hi, 1.0) * 100)}%"
        flag = "  (n<10, too small to read)" if n < 10 else ""
        print(f"  {label:>10}  {n:>5}  {mean_p:>8.3f}  {actual:>12.3f}{flag}")


def print_calibration_report(records: list[tuple[int, float, int]]) -> None:
    score = brier_score(records)
    print(f"\n{'═' * 60}")
    print("  Brier calibration report — pre-match SHIRTS-win probability")
    print(f"{'═' * 60}")
    print(f"  {len(records)} predictions")
    verdict = "beats" if score < BASELINE_BRIER else "does NOT beat"
    print(f"  Brier score: {score:.4f}  ({verdict} the always-0.5 baseline of {BASELINE_BRIER})")
    print_reliability_bands(records)


def run_grid(ordered_matches: list[dict], stats_by_match: dict, player_seeds: dict) -> None:
    print(f"\n{'═' * 60}")
    print("  Grid sweep")
    print(f"{'═' * 60}")
    print("  NOTE: EHOG_SCALE/EHOG_LAMBDA only reshape the display transform and never reach")
    print("  predict_win's raw mu/sigma — expect those columns to be flat. MOV_M_MIN/MOV_M_MAX")
    print("  are the knobs that actually move Brier here (BETA_FACTOR/SIGMA_FLOOR/SEASON_REGRESSION")
    print("  would too, but aren't swept by this flag).")
    print(f"\n  {'M_MIN':>6}  {'M_MAX':>6}  {'SCALE':>6}  {'LAMBDA':>7}  {'Brier':>7}")

    original = (engine.MOV_M_MIN, engine.MOV_M_MAX, engine.EHOG_SCALE, engine.EHOG_LAMBDA)
    try:
        for m_min in GRID_MOV_M_MIN:
            for m_max in GRID_MOV_M_MAX:
                for scale in GRID_EHOG_SCALE:
                    for lam in GRID_EHOG_LAMBDA:
                        engine.MOV_M_MIN = m_min
                        engine.MOV_M_MAX = m_max
                        engine.EHOG_SCALE = scale
                        engine.EHOG_LAMBDA = lam
                        records = run_calibration(ordered_matches, stats_by_match, player_seeds)
                        score = brier_score(records)
                        print(f"  {m_min:>6.2f}  {m_max:>6.2f}  {scale:>6.2f}  {lam:>7.2f}  {score:>7.4f}")
    finally:
        engine.MOV_M_MIN, engine.MOV_M_MAX, engine.EHOG_SCALE, engine.EHOG_LAMBDA = original


def main() -> None:
    parser = argparse.ArgumentParser(description="EHOG full rating recompute")
    parser.add_argument("--dry-run", action="store_true", help="Compute and print; do not write to DB")
    parser.add_argument(
        "--calibration",
        action="store_true",
        help="Score pre-match win predictions against outcomes (Brier score + reliability bands). Dry-run only.",
    )
    parser.add_argument(
        "--grid",
        action="store_true",
        help="With --calibration, sweep MOV_M_MIN/MOV_M_MAX/EHOG_SCALE/EHOG_LAMBDA and print Brier per combination.",
    )
    parser.add_argument(
        "--seasons",
        nargs="+",
        type=int,
        default=DEFAULT_SEASON_NUMBERS,
        metavar="N",
        help=f"Season numbers to include (default: {DEFAULT_SEASON_NUMBERS})",
    )
    args = parser.parse_args()

    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (or present in .env.local)")
        sys.exit(1)

    sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    player_names = fetch_player_names(sb)
    player_seeds = fetch_player_seeds(sb)

    print(f"Fetching chronological match list for seasons {args.seasons}...")
    ordered_matches = fetch_chronological_matches(sb, args.seasons, include_gauntlet=True)
    print(f"  {len(ordered_matches)} matches")

    match_ids = [m["match_id"] for m in ordered_matches]
    stats_by_match = fetch_match_player_stats(sb, match_ids)

    if args.calibration:
        if args.grid:
            run_grid(ordered_matches, stats_by_match, player_seeds)
        else:
            records = run_calibration(ordered_matches, stats_by_match, player_seeds)
            print_calibration_report(records)
        print("\n--calibration: dry-run only, nothing written to DB.")
        return

    def on_segment_end(segment, player_state):
        sn, ig = segment
        label = f"Season {sn} {'Gauntlet' if ig else 'Regular'} — end of segment"
        print_standings(label, player_state, player_names)

    history_rows, player_state, zero_round_matches = compute_ratings(
        ordered_matches,
        stats_by_match,
        player_seeds=player_seeds,
        on_segment_end=on_segment_end if args.dry_run else None,
    )

    print(f"\nComputed {len(history_rows)} history rows across {len(player_state)} players")
    if zero_round_matches:
        print(f"  {len(zero_round_matches)} match(es) had total rounds == 0 (MoV weight defaulted to 0.5/0.5):")
        for mid in zero_round_matches[:20]:
            print(f"    match_id={mid}")

    if args.dry_run:
        print("\n--dry-run: not writing to DB.")
        return

    print("\nClearing existing ratings...")
    clear_ratings(sb)
    print("Writing player_rating_history...")
    write_ratings(sb, history_rows, player_state)
    print("Done.")


if __name__ == "__main__":
    main()
