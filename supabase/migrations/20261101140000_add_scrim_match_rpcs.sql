-- Scrim match writes that touch more than one row, each in one transaction (the same pattern as
-- confirm_season_schedule_draft()): creating a night's next match with its four player rows, and
-- replacing a not-yet-played match's lineup. Called from src/lib/scrim-matches.ts.

-- Replaces a scrim match's lineup: exactly two players per side, four distinct players. Refuses a
-- match that isn't a scrim match or already has a score. A lineup change only happens before the
-- match is played, so the replaced player_match_stats rows carry no stats yet.
create or replace function public.set_scrim_match_lineup(
  p_match_id integer,
  p_shirts integer[],
  p_skins integer[]
)
returns void
language plpgsql
set search_path = public
as $function$
declare
  v_scrim_night_id integer;
  v_final_score text;
begin
  select scrim_night_id, final_score into v_scrim_night_id, v_final_score
  from matches where id = p_match_id for update;
  if v_scrim_night_id is null then
    raise exception 'Match % is not a scrim match', p_match_id;
  end if;
  if v_final_score is not null then
    raise exception 'Match % already has a score', p_match_id;
  end if;
  if coalesce(array_length(p_shirts, 1), 0) <> 2 or coalesce(array_length(p_skins, 1), 0) <> 2 then
    raise exception 'A scrim lineup needs two players per side';
  end if;
  if (select count(distinct player_id) from unnest(p_shirts || p_skins) as player_id) <> 4 then
    raise exception 'A scrim lineup cannot list a player twice';
  end if;

  delete from player_match_stats where match_id = p_match_id;
  insert into player_match_stats (match_id, player_id, faction)
  select p_match_id, player_id, 'SHIRTS'::faction_side_type from unnest(p_shirts) as player_id
  union all
  select p_match_id, player_id, 'SKINS'::faction_side_type from unnest(p_skins) as player_id;
end;
$function$;

-- Creates a scrim night's next match (numbered after its others) on `p_map`, with its lineup. Row-locks
-- the night so concurrent creates serialize, and refuses while the night already has a match without a
-- score — a night plays one match at a time on the one shared server. Returns the new match id.
create or replace function public.create_scrim_match(
  p_night_id integer,
  p_map text,
  p_shirts integer[],
  p_skins integer[]
)
returns integer
language plpgsql
set search_path = public
as $function$
declare
  v_match_id integer;
  v_match_number integer;
begin
  perform 1 from scrim_nights where id = p_night_id for update;
  if not found then
    raise exception 'Scrim night % not found', p_night_id;
  end if;
  if exists (select 1 from matches where scrim_night_id = p_night_id and final_score is null) then
    raise exception 'unplayed-scrim-match' using errcode = 'P0001';
  end if;

  select coalesce(max(match_number), 0) + 1 into v_match_number from matches where scrim_night_id = p_night_id;
  insert into matches (scrim_night_id, match_number, shirts_pick)
  values (p_night_id, v_match_number, p_map)
  returning id into v_match_id;

  perform set_scrim_match_lineup(v_match_id, p_shirts, p_skins);
  return v_match_id;
end;
$function$;
