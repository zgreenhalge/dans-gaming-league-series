-- A scrim match whose lobby chose a random starting side. The side stays unset (and unseen) until the
-- match is started, when it's flipped and stored in `skins_starting_side`. Only a scrim match can be
-- random — a league match's side comes from its pick/ban.
alter table public.matches
  add column scrim_random_side boolean not null default false,
  add constraint matches_scrim_random_side check (scrim_night_id is not null or not scrim_random_side);
