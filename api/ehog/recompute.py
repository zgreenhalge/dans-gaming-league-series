"""
EHOG rating recompute — Vercel Python serverless function.

Called by src/app/api/matches/[id]/score/route.ts (via after()) after a score
is persisted. Runs a full rating walk over all seasons and writes results to
player_rating_history + player_current_ratings, plus a frozen pre-match
SHIRTS-win probability onto any match that doesn't have one yet
(matches.pre_match_win_prob — see write_pre_match_win_probs in engine.py).

Authentication: caller must send RECOMPUTE_SECRET in the x-recompute-secret header.

NOTE: Vercel must be configured to include the repo-root ehog/ package in this
function's bundle. See vercel.json functions.api/ehog/recompute.py.includeFiles.
"""

import json
import os
import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path

# Repo root → ehog.engine importable. Vercel bundles ehog/ via includeFiles.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env.local")
except ImportError:
    pass

from supabase import create_client

from ehog.engine import (
    fetch_all_season_numbers,
    fetch_chronological_matches,
    fetch_match_player_stats,
    fetch_player_seeds,
    compute_ratings,
    predict_win,
    clear_ratings,
    write_ratings,
    write_pre_match_win_probs,
)

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL") or ""
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or ""
RECOMPUTE_SECRET = os.environ.get("RECOMPUTE_SECRET") or ""


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if not RECOMPUTE_SECRET or self.headers.get("x-recompute-secret") != RECOMPUTE_SECRET:
            self._respond(401, {"error": "Unauthorized"})
            return

        if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
            self._respond(500, {"error": "Supabase credentials not configured"})
            return

        try:
            sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
            season_numbers = fetch_all_season_numbers(sb)
            ordered_matches = fetch_chronological_matches(sb, season_numbers, include_gauntlet=True)
            match_ids = [m["match_id"] for m in ordered_matches]
            stats_by_match = fetch_match_player_stats(sb, match_ids)
            player_seeds = fetch_player_seeds(sb)

            predictions: dict[int, float] = {}

            def on_before_match(match_id, team_a_states, team_b_states, a_won):
                predictions[match_id] = predict_win(team_a_states, team_b_states)

            history_rows, player_state, _ = compute_ratings(
                ordered_matches, stats_by_match, player_seeds=player_seeds, on_before_match=on_before_match
            )
            clear_ratings(sb)
            write_ratings(sb, history_rows, player_state)
            predictions_written = write_pre_match_win_probs(sb, predictions)
            self._respond(200, {
                "ok": True,
                "matches": len(ordered_matches),
                "players": len(player_state),
                "pre_match_predictions_written": predictions_written,
            })
        except Exception as e:
            self._respond(500, {"error": str(e)})

    def _respond(self, status: int, body: dict) -> None:
        encoded = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, *args):
        pass  # suppress default access log noise
