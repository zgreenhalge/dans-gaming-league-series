import argparse
import os
from typing import List
import ingest_file


def find_csv_files(directory: str, pattern: str = None) -> List[str]:
    matches = []
    for root, _, files in os.walk(directory):
        for filename in files:
            # Skip Windows metadata files
            if ":Zone.Identifier" in filename:
                continue
            full_path = os.path.join(root, filename)
            if pattern:
                # simple fnmatch-like behavior
                import fnmatch
                if fnmatch.fnmatch(filename, pattern):
                    matches.append(full_path)
            else:
                if 'gauntlet' in filename.lower():
                    matches.append(full_path)
    return matches


def main():
    parser = argparse.ArgumentParser(description="Ingest Gauntlet CSVs as playoff matches (dry-run by default).")
    parser.add_argument("--pattern", default=None, help="Optional glob pattern to match files")
    parser.add_argument("--upload", action="store_true", help="Enable upload to Supabase (must be explicit)")
    parser.add_argument("--season", default=None, help="Optional season name override")
    args = parser.parse_args()

    search_dir = os.path.join(os.getcwd(), "Season Data")
    # If Season Data isn't present (tests or alternate layout), fall back to cwd
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
            else:
                ingest_file.verify_aggregated_stats(matches)
            if byes:
                print("\nDetected BYEs:")
                for b in byes:
                    print(f"  - Week {b.get('week')}: {b.get('player')}")
            else:
                print("No BYEs detected.")
            if args.upload:
                print("\n== Invoking upload for Gauntlet (playoff) file ==")
                # upload with playoff flag set and optional season override
                ingest_file.upload(matches, byes, csv_file, is_playoff=True, season_name_override=args.season)
            else:
                print("\n(Dry-run) To perform upload, re-run with --upload")
        except FileNotFoundError:
            print(f"File not found: {csv_file}")
        except Exception as e:
            print(f"Unhandled error during ingestion of {csv_file}: {e}")


if __name__ == '__main__':
    main()
