import os
import csv
import sys
from supabase import create_client, Client

# --- CONFIGURATION HUB ---
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY") 

# Connect to your cloud cluster
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# Local memory cache to prevent redundant database network calls
player_cache = {}

def get_or_create_player(player_name: str) -> int:
    """Ensures a player exists in the database and returns their unique ID."""
    name = player_name.strip()
    if not name or name.lower() in ['shirts', 'skins', '']:
        return None
        
    if name in player_cache:
        return player_cache[name]
        
    # Check if they exist in Supabase
    res = supabase.table("players").select("id").eq("name", name).execute()
    if res.data:
        player_cache[name] = res.data[0]["id"]
        return res.data[0]["id"]
        
    # If brand new player, register them automatically
    print(f"👤 Registering new league member: {name}")
    ins_res = supabase.table("players").insert({"name": name}).execute()
    if ins_res.data:
        player_cache[name] = ins_res.data[0]["id"]
        return ins_res.data[0]["id"]
    return None

def safe_int(val: str, default: int = 0) -> int:
    """Safely handles conversion of empty cells to integers without crashing."""
    clean = val.strip()
    if not clean:
        return default
    try:
        return int(float(clean))
    except ValueError:
        return default

def safe_bool(val: str) -> bool:
    """Translates varied win tracking strings into clean booleans."""
    clean = val.strip().lower()
    return clean in ['true', '1', 'win', 'w']

def parse_and_ingest():
    print("🚀 Initializing Season 3 Data Ingestion Engine...")
    
    # 1. Guarantee Season 3 metadata exists in the system
    season_payload = {
        "name": "Season 3",
        "status": "ACTIVE",
        "target_win_rounds": 13,
        "buy_in_amount": 10.00
    }
    season_res = supabase.table("seasons").upsert(season_payload, on_conflict="name").execute()
    season_id = season_res.data[0]["id"]
    print(f"✅ Target Season Synchronized (Database ID: {season_id})")
    
    # Read the text CSV file rows into memory
    try:
        with open('Season 3 Stat Tracker - S3 Regular Season.csv', mode='r', encoding='utf-8') as f:
            reader = list(csv.reader(f))
    except FileNotFoundError:
        print("❌ Error: Could not find 'Season 3 Stat Tracker - S3 Regular Season.csv' in this folder!")
        return

    current_week_id = None
    match_counter = 1

    # 2. Sequential scanning loop
    for idx, row in enumerate(reader):
        # Pad shorter structural lines to eliminate index errors
        while len(row) < 30:
            row.append("")
            
        # Context Match A: Identify structural Week blocks and Byes
        if "BYE" in row[12]:
            week_str = row[9].replace("Week", "").strip()
            current_week_num = int(week_str)
            bye_player_name = row[14].strip()
            
            print(f"\n📅 Processing Week {current_week_num} Block...")
            bye_player_id = get_or_create_player(bye_player_name)
            
            # Setup the weekly frame node
            week_payload = {
                "season_id": season_id,
                "week_number": current_week_num,
                "bye_player_id": bye_player_id
            }
            week_res = supabase.table("weeks").upsert(week_payload, on_conflict="season_id,week_number").execute()
            current_week_id = week_res.data[0]["id"]
            match_counter = 1 # Reset inner match loop counts for the new week block
            continue

        # Context Match B: Identify specific match scoreboard entries
        if "Final Score" in row[9]:
            # Scan downwards slightly to identify player pairing row bounds
            search_idx = idx + 1
            while search_idx < len(reader):
                next_row = reader[search_idx]
                if len(next_row) > 0 and next_row[0].strip() == "Shirts":
                    # Absolute structural row offsets found!
                    p1_row = reader[search_idx + 1]
                    p2_row = reader[search_idx + 2]
                    
                    while len(p1_row) < 30: p1_row.append("")
                    while len(p2_row) < 30: p2_row.append("")
                    
                    # Compute dynamic real-time scores based on filled tracking columns
                    s_won = safe_int(p1_row[7], -1)
                    sk_won = safe_int(p1_row[17], -1)
                    score_string = f"{s_won}-{sk_won}" if (s_won != -1 and sk_won != -1) else None
                    
                    # Package match entries
                    match_payload = {
                        "week_id": current_week_id,
                        "match_number": match_counter,
                        "final_score": score_string,
                        "shirts_ban": p1_row[20].strip() or None,
                        "skins_ban1": p1_row[21].strip() or None,
                        "skins_ban2": p1_row[22].strip() or None,
                        "shirts_pick": p1_row[23].strip() or None,
                        "skins_starting_side": p1_row[24].strip() or None
                    }
                    
                    match_res = supabase.table("matches").insert(match_payload).execute()
                    match_id = match_res.data[0]["id"]
                    print(f"  ⚔️ Logged Week Match {match_counter} (Database ID: {match_id})")
                    
                    # Extract Individual Player Performances safely
                    players_to_log = [
                        {"name": p1_row[0],  "faction": "SHIRTS", "row": p1_row, "offset": 0},
                        {"name": p2_row[0],  "faction": "SHIRTS", "row": p2_row, "offset": 0},
                        {"name": p1_row[10], "faction": "SKINS",  "row": p1_row, "offset": 10},
                        {"name": p2_row[10], "faction": "SKINS",  "row": p2_row, "offset": 10}
                    ]
                    
                    for p in players_to_log:
                        p_id = get_or_create_player(p["name"])
                        if not p_id: continue
                        o = p["offset"]
                        r = p["row"]
                        
                        stat_payload = {
                            "match_id": match_id,
                            "player_id": p_id,
                            "faction": p["faction"],
                            "kills": safe_int(r[o+1]),
                            "assists": safe_int(r[o+2]),
                            "deaths": safe_int(r[o+3]),
                            "adr": safe_int(r[o+4]),
                            "damage": safe_int(r[o+5]),
                            "rounds_played": safe_int(r[o+6]),
                            "rounds_won": safe_int(r[o+7]),
                            "is_win": safe_bool(r[o+8])
                        }
                        supabase.table("player_match_stats").insert(stat_payload).execute()
                    
                    match_counter += 1
                    break
                search_idx += 1

    print("\n🎉 [SUCCESS] All Season 3 matches and player stats successfully parsed and uploaded!")

if __name__ == "__main__":
    parse_and_ingest()
