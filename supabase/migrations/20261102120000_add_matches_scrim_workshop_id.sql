-- A scrim match can be played on any Steam Workshop map, not only those in `maps`: it carries the
-- item id itself (`scrim_workshop_id`), which the server is started on, with the map's name in
-- `shirts_pick` as usual. Only a scrim match has one — a league match's map comes from `maps`.
alter table public.matches
  add column scrim_workshop_id text check (scrim_workshop_id ~ '^\d+$'),
  add constraint matches_scrim_workshop_id check (scrim_night_id is not null or scrim_workshop_id is null);

-- `create_scrim_match()` takes the map's workshop id alongside its name.
drop function public.create_scrim_match(integer, text, integer[], integer[]);

-- Creates a scrim night's next match (numbered after its others) on the map `p_map` / `p_workshop_id`,
-- with its lineup and a knife round as its starting-side choice. Row-locks the night so concurrent
-- creates serialize, and refuses while the night already has a match without a score — a night plays
-- one match at a time on the one shared server. Returns the new match id.
create or replace function public.create_scrim_match(
  p_night_id integer,
  p_map text,
  p_workshop_id text,
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
  insert into matches (scrim_night_id, match_number, shirts_pick, scrim_workshop_id, scrim_side_choice)
  values (p_night_id, v_match_number, p_map, p_workshop_id, 'knife')
  returning id into v_match_id;

  perform set_scrim_match_lineup(v_match_id, p_shirts, p_skins);
  return v_match_id;
end;
$function$;
