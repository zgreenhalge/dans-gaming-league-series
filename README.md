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
