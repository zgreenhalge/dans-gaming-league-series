-- Queues scrim matches on a night in one transaction — one for an ad-hoc match, several for a
-- pre-matched set of rounds — played in order on the night's one server. `p_matches` is a JSON array of
-- `{ map, workshop_id, shirts: [a, b], skins: [c, d] }`, numbered after the night's other matches in
-- array order, each with a knife round as its starting-side choice. Row-locks the night so concurrent
-- queues serialize, and refuses while it already has a match without a score. Returns the new match
-- ids in order. Called from src/lib/scrim-matches.ts.
create or replace function public.queue_scrim_matches(
  p_night_id integer,
  p_matches jsonb
)
returns integer[]
language plpgsql
set search_path = public
as $function$
declare
  v_match jsonb;
  v_match_id integer;
  v_match_number integer;
  v_ids integer[] := '{}';
begin
  perform 1 from scrim_nights where id = p_night_id for update;
  if not found then
    raise exception 'Scrim night % not found', p_night_id;
  end if;
  if exists (select 1 from matches where scrim_night_id = p_night_id and final_score is null) then
    raise exception 'unplayed-scrim-match' using errcode = 'P0001';
  end if;
  if coalesce(jsonb_array_length(p_matches), 0) = 0 then
    raise exception 'No matches to queue';
  end if;

  select coalesce(max(match_number), 0) into v_match_number from matches where scrim_night_id = p_night_id;
  for v_match in select * from jsonb_array_elements(p_matches) loop
    v_match_number := v_match_number + 1;
    insert into matches (scrim_night_id, match_number, shirts_pick, scrim_workshop_id, scrim_side_choice)
    values (p_night_id, v_match_number, v_match->>'map', v_match->>'workshop_id', 'knife')
    returning id into v_match_id;
    perform set_scrim_match_lineup(
      v_match_id,
      array(select jsonb_array_elements_text(v_match->'shirts')::integer),
      array(select jsonb_array_elements_text(v_match->'skins')::integer)
    );
    v_ids := v_ids || v_match_id;
  end loop;
  return v_ids;
end;
$function$;
