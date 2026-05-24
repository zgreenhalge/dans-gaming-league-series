Handshake script

This directory contains handshake.py — a small utility to verify connectivity and basic permissions against a Supabase project.

Quickstart
1. Activate the project's virtualenv (if present):
   source dgls-env/bin/activate

2. Create a local .env from the example and fill values:
   cp .env.example .env
   # edit .env and set SUPABASE_URL and SUPABASE_KEY

3. Install dependencies (if needed):
   pip install supabase python-dotenv

4. Run the handshake test:
   python3 handshake.py

Notes
- The script loads .env automatically if python-dotenv is installed.
- Do NOT commit your real .env file. .env is listed in .gitignore.
- Use the service_role key for write tests or adjust RLS policies accordingly.
- For CI, store secrets in the CI provider's secret store rather than .env.

Database schema

This project uses [a Postgres schema in Supabase](https://ttxtzgkhmlvbgciekula.supabase.co) with the following tables:

- seasons
  - id (PK integer)
  - name (text, unique)
  - status (enum: UPCOMING, ACTIVE, ARCHIVED)
  - target_win_rounds (int)
  - buy_in_amount (numeric)
  - FK: weeks.season_id -> seasons.id

- players (Referenced by weeks.bye_player_id and player_match_stats.player_id)
  - id (PK)
  - name (text, unique)
  - discord_id (text, unique, nullable)

- weeks (Referenced by matches.week_id)
  - id (PK)
  - season_id (FK -> seasons.id)
  - week_number (int)
  - bye_player_id (FK -> players.id)

- matches (Referenced by player_match_stats.match_id)
  - id (PK)
  - week_id (FK -> weeks.id)
  - match_number (int)
  - final_score
  - picked_map
  - bans/picks
  - is_playoff_game (bool)
  - is_interpolated (bool)
  - notes

- player_match_stats
  - id (PK)
  - match_id (FK -> matches.id)
  - player_id (FK -> players.id)
  - faction (enum: SHIRTS, SKINS)
  - kills
  - assists
  - deaths
  - adr
  - damage
  - rounds_played
  - rounds_won
  - is_win (bool)

Security note
- Row Level Security (RLS) is currently disabled on these tables. This exposes rows to the anon/auth roles. Do NOT enable RLS without adding appropriate policies first — enabling RLS without policies will block access.

If help is wanted to add RLS policies or to review the schema, say so and assistance can be provided.
