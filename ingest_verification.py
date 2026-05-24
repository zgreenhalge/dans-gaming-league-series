import csv
import re
from collections import defaultdict

def clean_cell(val):
    return val.strip() if val else ""

def get_cell(row, i):
    return row[i] if i < len(row) else ""

def safe_int(val):
    try:
        if val is None:
            return 0
        s = str(val).strip()
        if s == "" or s in ["-", "—"]:
            return 0
        s = s.replace(",", "")  # allow thousand separators
        return int(float(s))
    except (ValueError, TypeError):
        return 0

def parse_regular_season(file_path):
    matches = []
    byes = []
    
    current_week = None
    
    with open(file_path, mode='r', encoding='utf-8-sig') as f:
        reader = csv.reader(f)
        rows = list(reader)
        
    idx = 0
    while idx < len(rows):
        row = [clean_cell(c) for c in rows[idx]]
        if not row or all(c == "" for c in row):
            idx += 1
            continue
            
        # 1. Scan for Week Identifiers (Handles both S1 and S2 column positions)
        for cell in row:
            week_match = re.search(r'Week\s+(\d+)', cell, re.IGNORECASE)
            if week_match:
                current_week = int(week_match.group(1))
                break
                
        # 2. Scan for Bye Weeks (robust to cell location)
        bye_player = None
        for c in row:
            if not c:
                continue
            # look for explicit 'bye: name' or 'bye' token anywhere in the row
            m = re.match(r'bye[:]?\s*(.*)', c, re.IGNORECASE)
            if m:
                bye_player = m.group(1).strip() or None
                break
        if not bye_player:
            # if any cell equals 'BYE' (case-insensitive), try to find nearby player name
            for i, c in enumerate(row):
                if str(c).strip().upper() == 'BYE':
                    # try cells to the right
                    if i+1 < len(row) and row[i+1].strip():
                        bye_player = row[i+1].strip()
                    elif i+2 < len(row) and row[i+2].strip():
                        bye_player = row[i+2].strip()
                    # fallback: look at next non-empty cell in next row
                    elif idx+1 < len(rows):
                        nextrow = [x.strip() for x in rows[idx+1] if x is not None]
                        if nextrow:
                            bye_player = nextrow[0]
                    break

        if bye_player:
            byes.append({"week": current_week, "player": bye_player})
            idx += 1
            continue
            
        # 3. Detect Match Data Block
        if any(str(c).strip().lower() == 'shirts' for c in row):
            # The next two rows contain the 2v2 player performance records
            if idx + 2 >= len(rows):
                print(f"⚠️ Incomplete match block starting at row {idx}; not enough following rows.")
                idx += 1
                continue
            row1 = [clean_cell(c) for c in rows[idx + 1]]
            row2 = [clean_cell(c) for c in rows[idx + 2]]

            # Extract match-level metadata defensively using get_cell
            match_meta = {
                "week": current_week,
                "shirts_ban": get_cell(row1, 20),
                "skins_ban_1": get_cell(row1, 21),
                "skins_ban_2": get_cell(row1, 22),
                "shirts_pick": get_cell(row1, 23),
                "skins_side": get_cell(row1, 24)
            }

            # Extract scores from protected columns using safe_int/get_cell
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
                # Skins player (cols 10..18)
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

            idx += 3  # Skip past the header + 2 player data rows
            continue
            
        idx += 1
        
    return matches, byes

def verify_aggregated_stats(matches):
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

if __name__ == "__main__":
    from ingest_file import main as ingest_main
    ingest_main()
