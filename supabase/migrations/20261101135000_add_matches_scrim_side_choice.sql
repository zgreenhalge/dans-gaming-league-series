-- A scrim match's starting-side choice from its lobby: SKINS start T (`skins_t`), SHIRTS start T
-- (`shirts_t`), a knife round (`knife`), or `random`. Every scrim match has one and no league match
-- does — a league match's side comes from its pick/ban. The choice is turned into the actual
-- `skins_starting_side` as the match starts, so a random side is flipped only then.
alter table public.matches
  add column scrim_side_choice text check (scrim_side_choice in ('skins_t', 'shirts_t', 'knife', 'random')),
  add constraint matches_scrim_side_choice check ((scrim_night_id is null) = (scrim_side_choice is null));
