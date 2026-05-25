import csv
import re
from collections import defaultdict
from typing import List, Dict, Tuple, Any

def clean_cell(val: str) -> str:
    return val.strip() if val else ""

def get_cell(row: List[str], i: int) -> str:
    return row[i] if i < len(row) else ""

def safe_int(val: Any) -> int:
    try:
        if val is None:
            return 0
        s = str(val).strip()
        if s == "" or s in ["-", "—"]:
            return 0
        s = s.replace(",", "")
        return int(float(s))
    except (ValueError, TypeError):
        return 0

def parse_regular_season(file_path: str) -> Tuple[List[Dict], List[Dict]]:
    matches = []
    byes = []
    current_week = None
    match_counter = 0  # Tracks match numbers within the current week
    
    with open(file_path, mode='r', encoding='utf-8-sig') as f:
        reader = csv.reader(f)
        rows = list(reader)
    idx = 0
    while idx < len(rows):
        row = [clean_cell(c) for c in rows[idx]]
        if not row or all(c == "" for c in row):
            idx += 1
            continue
        for cell in row:
            # FIX 1: Corrected regex to find actual spaces instead of literal '\s'
            week_match = re.search(r'Week\s+(\d+)', cell, re.IGNORECASE)
            if week_match:
                new_week = int(week_match.group(1))
                if new_week != current_week:
                    current_week = new_week
                    match_counter = 0  # Reset counter for the new week
                break
        bye_player = None
        for c in row:
            if not c:
                continue
            m = re.match(r'bye[:\s]*(.*)', c, re.IGNORECASE)
            if m and m.group(1).strip():
                bye_player = m.group(1).strip()
                break
        if not bye_player:
            for i, c in enumerate(row):
                if str(c).strip().upper() == 'BYE':
                    if i+1 < len(row) and row[i+1].strip():
                        bye_player = row[i+1].strip()
                    elif i+2 < len(row) and row[i+2].strip():
                        bye_player = row[i+2].strip()
                    elif idx+1 < len(rows):
                        nextrow = [x.strip() for x in rows[idx+1] if x is not None]
                        if nextrow:
                            bye_player = nextrow[0]
                    break
        if bye_player:
            byes.append({"week": current_week, "player": bye_player})
            idx += 1
            continue
        if any(str(c).strip().lower() == 'shirts' for c in row):
            if idx + 2 >= len(rows):
                print(f"⚠️ Incomplete match block starting at row {idx}; not enough following rows.")
                idx += 1
                continue
            
            match_counter += 1  # Increment the match number for this week
            
            row1 = [clean_cell(c) for c in rows[idx + 1]]
            row2 = [clean_cell(c) for c in rows[idx + 2]]
            
            # FIX 2: Explicitly pass 'match_number' into the metadata dictionary
            match_meta = {
                "week": current_week,
                "match_number": match_counter, 
                "shirts_ban": get_cell(row1, 20),
                "skins_ban_1": get_cell(row1, 21),
                "skins_ban_2": get_cell(row1, 22),
                "shirts_pick": get_cell(row1, 23),
                "skins_side": get_cell(row1, 24)
            }
            shirts_score = safe_int(get_cell(row1, 7))
            skins_score = safe_int(get_cell(row1, 17))
            match_meta["shirts_score"] = shirts_score
            match_meta["skins_score"] = skins_score
            players_performance = []
            for r in [row1, row2]:
                name_shirts = get_cell(r, 0)
                if name_shirts:
                    players_performance.append({
                        "player_name": name_shirts,
                        "team": "Shirts",
                        "kills": safe_int(get_cell(r, 1)),
                        "assists": safe_int(get_cell(r, 2)),
                        "deaths": safe_int(get_cell(r, 3)),
                        "adr": safe_int(get_cell(r, 4)),
                        "damage": safe_int(get_cell(r, 5)),
                        "rounds_played": safe_int(get_cell(r, 6)),
                        "rounds_won": safe_int(get_cell(r, 7)),
                        "win": safe_int(get_cell(r, 8)) == 1
                    })
                name_skins = get_cell(r, 10)
                if name_skins:
                    players_performance.append({
                        "player_name": name_skins,
                        "team": "Skins",
                        "kills": safe_int(get_cell(r, 11)),
                        "assists": safe_int(get_cell(r, 12)),
                        "deaths": safe_int(get_cell(r, 13)),
                        "adr": safe_int(get_cell(r, 14)),
                        "damage": safe_int(get_cell(r, 15)),
                        "rounds_played": safe_int(get_cell(r, 16)),
                        "rounds_won": safe_int(get_cell(r, 17)),
                        "win": safe_int(get_cell(r, 18)) == 1
                    })
            matches.append({
                "metadata": match_meta,
                "performances": players_performance
            })
            idx += 3
            continue
        idx += 1
    return matches, byes

def verify_aggregated_stats(matches: List[Dict]) -> None:
    player_totals = defaultdict(lambda: {
        "kills": 0, "assists": 0, "deaths": 0, "damage": 0,
        "wins": 0, "losses": 0, "rounds_played": 0
    })
    for match in matches:
        for perf in match["performances"]:
            name = perf["player_name"]
            player_totals[name]["kills"] += perf["kills"]
            player_totals[name]["assists"] += perf["assists"]
            player_totals[name]["deaths"] += perf["deaths"]
            player_totals[name]["damage"] += perf["damage"]
            player_totals[name]["rounds_played"] += perf["rounds_played"]
            if perf["win"]:
                player_totals[name]["wins"] += 1
            else:
                player_totals[name]["losses"] += 1
    print(f"{'Player':<12} | {'Kills':<6} | {'Assists':<7} | {'Deaths':<6} | {'Damage':<8} | {'W-L':<6} | {'ADR':<4}")
    print("-" * 60)
    for player, stats in sorted(player_totals.items()):
        adr = round(stats["damage"] / stats["rounds_played"]) if stats["rounds_played"] > 0 else 0
        wl_str = f"{stats['wins']}-{stats['losses']}"
        print(f"{player:<12} | {stats['kills']:<6} | {stats['assists']:<7} | {stats['deaths']:<6} | {stats['damage']:<8} | {wl_str:<6} | {adr:<4}")

# Returns the integer value if it exists, or -1 if the value is None.
def default_stat(val: Any) -> int:
    return int(val) if val is not None else -1


def upload(matches, byes, source_file: str, is_playoff: bool = False, season_name_override: str = None):
    """Upload parsed CSV data to Supabase.

    This function attempts to be robust against different supabase client return shapes
    (dict-like or object with .data/.error) and will create or reuse seasons, weeks,
    players, matches, and player_match_stats rows.
    """
    import os
    # Load .env file if present (python-dotenv) to simplify local dev, like handshake.py
    try:
        from dotenv import load_dotenv, find_dotenv
        dotenv_path = find_dotenv()
        _loaded = load_dotenv()
        if _loaded:
            path_display = dotenv_path if dotenv_path else ".env"
            print(f"✅ LOADED .env from '{path_display}'")
    except Exception:
        # python-dotenv not installed or .env missing; continue and rely on environment
        pass

    # Try to import Supabase client; fall back to "stub" mode if unavailable
    create_client = None
    try:
        from supabase import create_client as _create_client
        create_client = _create_client
    except Exception:
        print("Supabase Python client not available. Install with: pip install supabase")
        create_client = None

    SUPABASE_URL = os.environ.get("SUPABASE_URL")
    SUPABASE_KEY = os.environ.get("SUPABASE_KEY") or os.environ.get("SUPABASE_ANON_KEY")

    if create_client and SUPABASE_URL and SUPABASE_KEY:
        supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    else:
        # Operate in stub mode (no network). Upload-related helpers will print actions instead of calling Supabase.
        supabase = None
        if not create_client:
            print("Proceeding in STUB mode: no Supabase client available.")
        else:
            print("Proceeding in STUB mode: SUPABASE_URL or SUPABASE_KEY not set.")

    def _rows_from_response(resp):
        if resp is None:
            return []
        if hasattr(resp, "data"):
            return resp.data or []
        if isinstance(resp, dict):
            return resp.get("data") or []
        # Fallback: try to index
        try:
            return resp["data"]
        except Exception:
            return []

    def _single_from_response(resp):
        rows = _rows_from_response(resp)
        return rows[0] if rows else None

    def get_or_create_season(name: str):
        if supabase is None:
            print(f"(stub) Would create or use season: {name}")
            return -1
        resp = supabase.table("seasons").select("*").eq("name", name).limit(1).execute()
        row = _single_from_response(resp)
        if row:
            print(f"Using existing season: {row}")
            return row["id"]
        payload = {"name": name, "status": "ACTIVE", "target_win_rounds": 13, "buy_in_amount": 10.0}
        resp = supabase.table("seasons").insert(payload).select("id").execute()
        row = _single_from_response(resp)
        if row:
            print(f"Created season id={row['id']}")
            return row["id"]
        raise RuntimeError(f"Failed to create season: {payload}")

    def get_or_create_player(name: str):
        if not name:
            return None
        if supabase is None:
            print(f"(stub) Would get or create player: {name}")
            return -1
        resp = supabase.table("players").select("*").eq("name", name).limit(1).execute()
        row = _single_from_response(resp)
        if row:
            return row["id"]
        resp = supabase.table("players").insert({"name": name}).select("id").execute()
        row = _single_from_response(resp)
        if row:
            return row["id"]
        raise RuntimeError(f"Failed to create player: {name}")

    def get_or_create_week(season_id: int, week_number: int, bye_player_name: str = None):
        if supabase is None:
            print(f"(stub) Would create or use week: season_id={season_id}, week_number={week_number}, bye_player={bye_player_name}")
            return -1
        resp = supabase.table("weeks").select("*").eq("season_id", season_id).eq("week_number", week_number).limit(1).execute()
        row = _single_from_response(resp)
        if row:
            return row["id"]
        bye_player_id = get_or_create_player(bye_player_name) if bye_player_name else None
        payload = {"season_id": season_id, "week_number": week_number, "bye_player_id": bye_player_id}
        resp = supabase.table("weeks").insert(payload).select("id").execute()
        row = _single_from_response(resp)
        if row:
            return row["id"]
        raise RuntimeError(f"Failed to create week: {payload}")

    def create_match(week_id: int, match_number: int, meta: dict):
        shirts_score = meta.get("shirts_score")
        skins_score = meta.get("skins_score")
        
        # Check if scores are explicitly None (data missing), 
        # but allow 0 to remain 0.
        sh_score_str = str(shirts_score)
        sk_score_str = str(skins_score)
        
        if shirts_score is not None and skins_score is not None:
            final_score = f"{shirts_score}-{skins_score}"
        else:
            final_score = None
        payload = {
            "week_id": week_id,
            "match_number": match_number or -1,
            "shirts_ban": meta.get("shirts_ban") or meta.get("shirts_ban_1") or None,
            "skins_ban1": meta.get("skins_ban_1") or meta.get("skins_ban1") or None,
            "skins_ban2": meta.get("skins_ban_2") or meta.get("skins_ban2") or None,
            "shirts_pick": meta.get("shirts_pick") or None,
            "skins_starting_side": meta.get("skins_side") or meta.get("skins_starting_side") or None,
            "final_score": final_score,
        }
        # Add playoff flag for gauntlet imports if requested.
        if is_playoff:
            payload["is_playoff_game"] = True
        # Remove None values so Supabase uses defaults
        payload = {k: v for k, v in payload.items() if v is not None}
        if supabase is None:
            print(f"(stub) Would create match: week_id={week_id}, match_number={match_number}, final_score={final_score}, is_playoff_game={is_playoff}")
            return -1
        resp = supabase.table("matches").insert(payload).select("id").execute()
        row = _single_from_response(resp)
        if row:
            return row["id"]
        raise RuntimeError(f"Failed to create match: {payload}")

    def create_player_stats(match_id: int, player_id: int, perf: dict):
        faction = (perf.get("team") or perf.get("faction") or "").upper()
        if faction.startswith("S"):
            # normalize to SHIRTS/SKINS
            faction = "SHIRTS" if "SHIRT" in faction or "SHIRTS" in faction or perf.get("team") == "Shirts" else faction
            if faction not in ("SHIRTS", "SKINS"):
                faction = "SHIRTS" if perf.get("team", "").lower().startswith("s") else None
        payload = {
            "match_id": match_id,
            "player_id": player_id,
            "faction": faction if faction in ("SHIRTS", "SKINS") else None,
            "kills": default_stat(perf.get("kills")),
            "assists": default_stat(perf.get("assists")),
            "deaths": default_stat(perf.get("deaths")),
            "adr": default_stat(perf.get("adr")),
            "damage": default_stat(perf.get("damage")),
            "rounds_played": default_stat(perf.get("rounds_played")),
            "rounds_won": default_stat(perf.get("rounds_won")),
            "is_win": bool(perf.get("win"))
        }
        # Clean None values
        payload = {k: v for k, v in payload.items() if v is not None}
        if supabase is None:
            print(f"(stub) Would create player_match_stats: match_id={match_id}, player_id={player_id}, payload={payload}")
            return -1
        resp = supabase.table("player_match_stats").insert(payload).select("id").execute()
        row = _single_from_response(resp)
        if row:
            return row["id"]
        raise RuntimeError(f"Failed to create player_match_stats: {payload}")

    # Assumes source_file name in format of "Season # Stat Tracker - S# <suffix>"
    def get_season_name(source_file):
        # 1. Extract the number from the beginning
        num_match = re.search(r'Season\s+(\d+)', source_file, re.IGNORECASE)
        season_num = num_match.group(1) if num_match else ""
        
        # 2. Extract everything after "Stat Tracker"
        suffix_match = re.search(r'Stat\s+Tracker\s*(.*)', source_file, re.IGNORECASE)
        if suffix_match:
            # Remove extension and trim
            suffix = suffix_match.group(1).replace('.csv', '').strip()
            
            # 3. Clean the suffix: Remove the ' - S#' pattern (including dashes/spaces)
            # This looks for an optional dash/space, then 'S', then digits
            suffix = re.sub(r'[-\s]*S\d+\s*', '', suffix)
            
            # 4. Reconstruct: "Season " + Number + " " + Suffix
            return f"Season {season_num} {suffix}".strip()
            
        return "Unknown Season"

    # Allow caller to override season name (useful for gauntlet imports)
    season_name = season_name_override if season_name_override else get_season_name(source_file)
    season_id = get_or_create_season(season_name)

    # create weeks
    seen_week_ids = {}
    for b in byes:
        wk = b.get("week") or -1
        if wk in seen_week_ids:
            continue
        week_id = get_or_create_week(season_id, wk, b.get("player"))
        seen_week_ids[wk] = week_id
        print(f"Created/using week id={week_id} for week {wk}")

    # matches and player stats
    for m in matches:
        meta = m.get("metadata", {})
        week_num = meta.get("week") or -1
        match_number = meta.get("match_number") or -1
        week_id = seen_week_ids.get(week_num) or get_or_create_week(season_id, week_num)
        match_id = create_match(week_id, match_number, meta)
        print(f"Created match id={match_id} (week {week_num} # {match_number})")
        for perf in m.get("performances", []):
            pname = perf.get("player_name")
            player_id = get_or_create_player(pname)
            stat_id = create_player_stats(match_id, player_id, perf)
            print(f"Created player_match_stats id={stat_id} for player {pname} (id={player_id})")


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Ingest and verify a regular season CSV (dry-run by default).")
    parser.add_argument("csv_file")
    parser.add_argument("--upload", action="store_true", help="Enable stub upload output (prints stubbed payloads)")
    args = parser.parse_args()
    try:
        matches, byes = parse_regular_season(args.csv_file)
        if not matches:
            print(f"No matches parsed from {args.csv_file}.")
        else:
            verify_aggregated_stats(matches)
        if byes:
            print("\nDetected BYEs:")
            for b in byes:
                print(f"  - Week {b.get('week')}: {b.get('player')}")
        else:
            print("No BYEs detected.")
        if args.upload:
            print("\n=== STUB UPLOAD MODE ENABLED ===")
            upload(matches, byes, args.csv_file)
    except FileNotFoundError:
        print(f"File not found: {args.csv_file}")
    except Exception as e:
        print(f"Unhandled error during ingestion: {e}")

if __name__ == "__main__":
    main()
