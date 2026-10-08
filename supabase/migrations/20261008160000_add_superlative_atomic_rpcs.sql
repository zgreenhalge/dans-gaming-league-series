-- Superlatives writes that touch several rows. Each function runs as one Postgres transaction, so a
-- failure part-way leaves the stored state unchanged.

-- Replaces one voter's ballot for a set of superlatives: every vote the voter holds on
-- `p_superlative_ids` is removed, then `p_votes` — an array of
-- `{ superlative_id, nominee_player_id }` — is inserted. A superlative left out of `p_votes` ends up
-- with no vote from this voter.
create or replace function public.replace_superlative_votes(
  p_voter_player_id integer,
  p_superlative_ids integer[],
  p_votes jsonb
)
returns void
language plpgsql
as $function$
begin
  delete from superlative_votes
  where voter_player_id = p_voter_player_id
    and superlative_id = any (p_superlative_ids);

  insert into superlative_votes (superlative_id, voter_player_id, nominee_player_id)
  select v.superlative_id, p_voter_player_id, v.nominee_player_id
  from jsonb_to_recordset(p_votes) as v(superlative_id integer, nominee_player_id integer)
  where v.superlative_id = any (p_superlative_ids);
end;
$function$;

-- Sets a season's superlative positions to `p_order` (superlative ids, first = position 1).
-- `(season_id, position)` is unique and checked per row, so the rows are first parked on negative
-- positions, clear of every live one, then placed.
create or replace function public.reorder_superlatives(
  p_season_id integer,
  p_order integer[]
)
returns void
language plpgsql
as $function$
begin
  update superlatives s
  set position = -o.ord
  from unnest(p_order) with ordinality as o(id, ord)
  where s.id = o.id and s.season_id = p_season_id;

  update superlatives s
  set position = o.ord
  from unnest(p_order) with ordinality as o(id, ord)
  where s.id = o.id and s.season_id = p_season_id;
end;
$function$;
