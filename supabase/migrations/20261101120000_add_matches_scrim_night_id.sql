-- A match belongs to exactly one of a season week (a league match) or a scrim night (a scrim match).
-- League reads scope through `weeks`, so a scrim match — which has no week — never reaches season,
-- career, map, H2H or EHOG figures (see src/lib/queries-scrim-isolation.test.ts). A scrim match is
-- never a playoff game, so `is_playoff_game` filters (gauntlet stats) can't pick one up either.
alter table public.matches
  add column scrim_night_id integer references public.scrim_nights(id) on delete cascade,
  add constraint matches_week_or_scrim_night check ((week_id is null) <> (scrim_night_id is null)),
  add constraint matches_scrim_not_playoff check (scrim_night_id is null or is_playoff_game is not true);
create index matches_scrim_night_id_idx on public.matches using btree (scrim_night_id);
