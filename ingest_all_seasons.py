import argparse
import os
import fnmatch
from typing import List
import ingest_file

def find_csv_files(directory: str, pattern: str) -> List[str]:
    matches = []
    for root, _, files in os.walk(directory):
        for filename in files:
            if fnmatch.fnmatch(filename, pattern):
                matches.append(os.path.join(root, filename))
    return matches

def main():
    parser = argparse.ArgumentParser(description="Ingest and verify all regular season CSVs in a directory.")
    parser.add_argument("--dir", default=os.getcwd(), help="Directory to search for CSV files")
    parser.add_argument("--pattern", default="*Regular Season*.csv", help="Glob pattern for CSV files")
    args = parser.parse_args()
    csv_files = find_csv_files(args.dir, args.pattern)
    if not csv_files:
        print(f"No CSV files found in {args.dir} matching pattern '{args.pattern}'.")
        return
    for csv_file in csv_files:
        print(f"\n=== Processing: {csv_file} ===")
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
        except FileNotFoundError:
            print(f"File not found: {csv_file}")
        except Exception as e:
            print(f"Unhandled error during ingestion of {csv_file}: {e}")

if __name__ == "__main__":
    main()
