"""
DGLS EHOG Rating Backfill — full chronological recompute for Seasons 1–N.

Reads all played matches from Supabase in order, runs the rating walk, then
clears and rewrites player_rating_history + players.ehog_rating.

Use --dry-run to compute and print standings without touching the DB.

See ehog/engine.py for the rating math.
See ehog_handoff/schema.sql for the required DB migration.

Setup:
  pip install supabase openskill python-dotenv
  python ehog/backfill.py --dry-run
  python ehog/backfill.py
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

from ehog.engine import (
    fetch_chronological_matches,
    fetch_match_player_stats,
    fetch_player_names,
    compute_ratings,
    clear_ratings,
    write_ratings,
)

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL") or ""
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or ""
DEFAULT_SEASON_NUMBERS = [1, 2, 3]


def print_standings(label: str, player_state: dict, player_names: dict[int, str]) -> None:
    print(f"\n{'─' * 60}")
    print(f"  {label}")
    print(f"{'─' * 60}")
    print(f"  {'#':>2}  {'name':<20s}  {'mu':>7}  {'sigma':>6}  {'EHOG':>7}")
    ranked = sorted(player_state.items(), key=lambda kv: kv[1][2], reverse=True)
    for rank, (pid, (mu, sigma, ehog)) in enumerate(ranked, start=1):
        name = player_names.get(pid, f"id={pid}")
        print(f"  #{rank:2d}  {name:<20s}  {mu:>7.3f}  {sigma:>6.3f}  {ehog:>7.3f}")


def main() -> None:
    parser = argparse.ArgumentParser(description="EHOG full rating recompute")
    parser.add_argument("--dry-run", action="store_true", help="Compute and print; do not write to DB")
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

    print(f"Fetching chronological match list for seasons {args.seasons}...")
    ordered_matches = fetch_chronological_matches(sb, args.seasons, include_gauntlet=True)
    print(f"  {len(ordered_matches)} matches")

    match_ids = [m["match_id"] for m in ordered_matches]
    stats_by_match = fetch_match_player_stats(sb, match_ids)

    def on_segment_end(segment, player_state):
        sn, ig = segment
        label = f"Season {sn} {'Gauntlet' if ig else 'Regular'} — end of segment"
        print_standings(label, player_state, player_names)

    history_rows, player_state, zero_round_matches = compute_ratings(
        ordered_matches,
        stats_by_match,
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
