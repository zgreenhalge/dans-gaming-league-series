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

This project uses [a Postgres schema in Supabase](https://supabase.com/dashboard/project/ttxtzgkhmlvbgciekula): 

<img width="917" height="512" alt="image" src="https://github.com/user-attachments/assets/82a6420a-5ec4-42a0-971a-6744d6c9fa1e" />


Security note
- Row Level Security (RLS) is currently disabled on these tables. This exposes rows to the anon/auth roles. Do NOT enable RLS without adding appropriate policies first — enabling RLS without policies will block access.

If help is wanted to add RLS policies or to review the schema, say so and assistance can be provided.
