# DGLS Ingestion Pipeline

Python scripts that parse CSV season exports and write them to Supabase. Not deployed — runs locally only.

## Setup

A venv exists at `dgls-env/`. Activate it:

```bash
source dgls-env/bin/activate
```

If it's missing, re-create it:

```bash
python3 -m venv dgls-env && source dgls-env/bin/activate
pip install supabase python-dotenv
```

Copy `.env.example` to `.env` and fill in `SUPABASE_URL` and `SUPABASE_KEY`. Use the **service_role key** for writes — the anon key reads fine but writes silently return empty data due to API key permission gates (not RLS).

## Commands

```bash
python3 handshake.py                         # verify Supabase connectivity + RLS
python3 ingest_file.py <path.csv>            # dry-run parse + print aggregated stats
python3 ingest_file.py <path.csv> --upload   # write to Supabase
python3 ingest_all_seasons.py                # walks ./Season Data/ for *Regular Season.csv
python3 ingest_all_seasons.py --upload       # bulk upload all seasons
python3 import_gauntlets.py                  # import gauntlet season data
```

Season CSV files live in `Season Data/` (note the space — quote the path in shell commands).

## Tests

```bash
python3 -m unittest tests.test_ingest                                              # all tests
python3 -m unittest tests.test_ingest.IngestTests.test_verification_dry_run       # single test
```

Tests shell out to the ingest scripts via `subprocess.run` — they exercise the real CLI surface. Keep argparse flags stable. Tests run dry-run only and never hit Supabase.

## Parser shape

`ingest_file.py:parse_regular_season(path)` is a positional CSV state machine, not a header-driven reader. It walks rows linearly, switching mode on sentinel cells:

- A cell matching `Week\s+(\d+)` resets the current week and per-week match counter.
- A `bye:` or `BYE` cell records a bye for the current week and skips the row.
- A row containing the literal `Shirts` starts a 3-row match block. Player stats are pulled from **fixed column indices** (Shirts cols 0–8, Skins cols 10–18; veto/score metadata in cols 17, 20–24 of row1).

If you change the source CSV layout, those indices at `ingest_file.py:80-126` break silently.

`upload()` does serial get-or-create lookups per row (`seasons`, `weeks`, `players`, `matches`, `player_match_stats`). Season name is derived from filename via `get_season_name()` — expects `Season N Stat Tracker - S N <suffix>.csv`.

## Notes

- Source CSVs may have `:Zone.Identifier` siblings (Windows download metadata). `ingest_all_seasons.py` filters them out by substring — don't break that check.
- `default_stat()` returns `-1` for `None`, not `0`. Aggregations and the leaderboard view tolerate `-1` sentinels.
- RLS is **off** on all tables. Do not enable it without writing policies first — enabling RLS with no policies blocks all access.
- Do NOT commit `.env`. It is listed in `.gitignore`.
