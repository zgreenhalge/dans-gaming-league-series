import argparse
import os
import re
from typing import List
import ingest_file


def patch_season(season_name: str) -> None:
    """Set status=ARCHIVED and is_gauntlet=True on the season after upload."""
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except Exception:
        pass
    try:
        from supabase import create_client
    except Exception:
        print("(stub) Would patch season: status=ARCHIVED, is_gauntlet=True")
        return

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY") or os.environ.get("SUPABASE_ANON_KEY")
    if not url or not key:
        print("(stub) SUPABASE_URL/KEY not set — skipping season patch")
        return

    supabase = create_client(url, key)
    resp = (
        supabase.table("seasons")
        .update({"status": "ARCHIVED", "is_gauntlet": True})
        .eq("name", season_name)
        .execute()
    )
    updated = resp.data if hasattr(resp, "data") else []
    if updated:
        print(f"Patched season '{season_name}': status=ARCHIVED, is_gauntlet=True")
    else:
        print(f"Warning: season patch returned no rows for '{season_name}' — check name matches DB")


def find_csv_files(directory: str, pattern: str = None) -> List[str]:
    matches = []
    for root, _, files in os.walk(directory):
        for filename in files:
            # Skip Windows metadata files
            if ":Zone.Identifier" in filename:
                continue
            full_path = os.path.join(root, filename)
            if pattern:
                import fnmatch
                if fnmatch.fnmatch(filename, pattern):
                    matches.append(full_path)
            else:
                if 'gauntlet' in filename.lower():
                    matches.append(full_path)
    return matches


def assign_round_numbers(matches: list) -> list:
    """
    Gauntlet CSVs have no 'Week N' markers so all matches parse into week -1.
    Re-number so every pair of matches becomes a round:
      matches[0], matches[1] → round 1, match_number 1 and 2
      matches[2], matches[3] → round 2, match_number 1 and 2
      etc.
    """
    for i, match in enumerate(matches):
        round_number = i // 2 + 1
        within_round = i % 2 + 1
        match["metadata"]["week"] = round_number
        match["metadata"]["match_number"] = within_round
    return matches


def main():
    parser = argparse.ArgumentParser(description="Ingest Gauntlet CSVs as playoff matches (dry-run by default).")
    parser.add_argument("--pattern", default=None, help="Optional glob pattern to match files")
    parser.add_argument("--upload", action="store_true", help="Enable upload to Supabase (must be explicit)")
    parser.add_argument("--season", default=None, help="Optional season name override")
    args = parser.parse_args()

    search_dir = os.path.join(os.getcwd(), "Season Data")
    if not os.path.isdir(search_dir):
        search_dir = os.getcwd()
    csv_files = find_csv_files(search_dir, args.pattern)
    csv_files.sort()

    if not csv_files:
        print(f"No Gauntlet CSV files found in {search_dir}.")
        return

    for csv_file in csv_files:
        print(f"\n=== Processing Gauntlet file: {csv_file} ===")
        try:
            matches, byes = ingest_file.parse_regular_season(csv_file)
            if not matches:
                print(f"No matches parsed from {csv_file}.")
                continue

            matches = assign_round_numbers(matches)

            rounds = (len(matches) + 1) // 2
            print(f"Parsed {len(matches)} matches → {rounds} rounds")
            for i, m in enumerate(matches):
                meta = m["metadata"]
                print(f"  Round {meta['week']}, Match {meta['match_number']}: {meta.get('map', 'TBD')} — {meta.get('final_score', 'pending')}")

            ingest_file.verify_aggregated_stats(matches)

            if byes:
                print("\nDetected BYEs:")
                for b in byes:
                    print(f"  - Week {b.get('week')}: {b.get('player')}")
            else:
                print("No BYEs detected.")

            if args.upload:
                print("\n== Invoking upload for Gauntlet (playoff) file ==")
                # Derive the season name the same way upload() does internally.
                if args.season:
                    season_name = args.season
                else:
                    num_m = re.search(r'Season\s+(\d+)', csv_file, re.IGNORECASE)
                    suf_m = re.search(r'Stat\s+Tracker\s*(.*)', csv_file, re.IGNORECASE)
                    if num_m and suf_m:
                        suffix = re.sub(r'[-\s]*S\d+\s*', '', suf_m.group(1).replace('.csv', '').strip())
                        season_name = f"Season {num_m.group(1)} {suffix}".strip()
                    else:
                        season_name = None
                ingest_file.upload(matches, byes, csv_file, is_playoff=True, season_name_override=args.season)
                if season_name:
                    patch_season(season_name)
                else:
                    print("Warning: could not determine season name for patch — run manually or use --season")
            else:
                print("\n(Dry-run) To perform upload, re-run with --upload")
        except FileNotFoundError:
            print(f"File not found: {csv_file}")
        except Exception as e:
            print(f"Unhandled error during ingestion of {csv_file}: {e}")


if __name__ == '__main__':
    main()
