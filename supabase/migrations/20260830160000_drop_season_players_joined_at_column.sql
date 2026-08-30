-- joined_at has never been read or explicitly written by application code — season_players rows
-- only ever need season_id/player_id (POST /api/seasons/[id]/players, getSeasonRoster()).

alter table public.season_players
  drop column joined_at;
