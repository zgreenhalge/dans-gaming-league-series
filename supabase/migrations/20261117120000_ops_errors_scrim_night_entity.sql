-- `ops_errors` rows can attach to a scrim night (`entity_id` is `scrim_nights.id`): a failed Discord
-- announcement, night message or reminder schedule (src/lib/discord-scrim-notify.ts).
alter table public.ops_errors drop constraint ops_errors_entity_type_check;
alter table public.ops_errors add constraint ops_errors_entity_type_check
  check (entity_type = any (array['season', 'match', 'player', 'system', 'scrim_night']));
