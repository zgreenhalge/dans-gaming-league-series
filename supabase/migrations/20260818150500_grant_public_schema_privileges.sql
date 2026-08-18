-- `20260101000000_init_schema.sql` was reconstructed from production via pg_catalog introspection,
-- which captures table/column DDL but not privilege grants. Production's `anon`/`authenticated`/
-- `service_role` roles already have full privileges on every `public` table (granted out of band,
-- outside migration history) — RLS is off repo-wide (see docs/architecture.md), so these grants are
-- what actually gates access. A `supabase start` stack built purely from migrations has none of
-- that, so every request as `anon`/`service_role` fails with `permission denied`. This migration
-- codifies the grants production already has, and covers future tables via `alter default
-- privileges` so this can't silently drift again.

grant usage on schema public to anon, authenticated, service_role;

grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all functions in schema public to anon, authenticated, service_role;

alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
