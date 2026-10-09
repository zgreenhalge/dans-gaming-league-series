-- Player-side saves for the survey and the superlatives vote that land only while the form is open.
-- Each function takes a share lock on the form's row (`surveys` / `superlative_polls`), the row the
-- admin close and reset write to first, so a save and a close or reset are ordered: a save that
-- gets the lock first is stored and a reset then removes it; one that waits re-reads the row after
-- the admin write commits and sees it closed. Each returns whether it wrote — false means the form
-- is closed (or does not exist) and nothing changed. Only the service role may execute them.

-- Replaces one voter's ballot for a set of superlatives, but only while the season's poll is open:
-- every vote the voter holds on `p_superlative_ids` is removed, then `p_votes` — an array of
-- `{ superlative_id, nominee_player_id }` — is inserted. A superlative left out of `p_votes` ends up
-- with no vote from this voter.
drop function if exists public.replace_superlative_votes(integer, integer[], jsonb);

create function public.replace_superlative_votes(
  p_season_id integer,
  p_voter_player_id integer,
  p_superlative_ids integer[],
  p_votes jsonb
)
returns boolean
language plpgsql
set search_path = ''
as $function$
begin
  perform 1 from public.superlative_polls where season_id = p_season_id and is_open for share;
  if not found then
    return false;
  end if;

  delete from public.superlative_votes
  where voter_player_id = p_voter_player_id
    and superlative_id = any (p_superlative_ids);

  insert into public.superlative_votes (superlative_id, voter_player_id, nominee_player_id)
  select v.superlative_id, p_voter_player_id, v.nominee_player_id
  from jsonb_to_recordset(p_votes) as v(superlative_id integer, nominee_player_id integer)
  where v.superlative_id = any (p_superlative_ids);
  return true;
end;
$function$;

-- Stores one player's answers to a survey (replacing their earlier response), but only while the
-- survey is open: `closed_at is null`.
create function public.save_survey_response(
  p_survey_id integer,
  p_player_id integer,
  p_answers jsonb
)
returns boolean
language plpgsql
set search_path = ''
as $function$
begin
  perform 1 from public.surveys where id = p_survey_id and closed_at is null for share;
  if not found then
    return false;
  end if;

  insert into public.survey_responses (survey_id, player_id, answers, updated_at)
  values (p_survey_id, p_player_id, p_answers, now())
  on conflict (survey_id, player_id)
  do update set answers = excluded.answers, updated_at = excluded.updated_at;
  return true;
end;
$function$;

revoke all on function public.replace_superlative_votes(integer, integer, integer[], jsonb) from public, anon, authenticated;
revoke all on function public.save_survey_response(integer, integer, jsonb) from public, anon, authenticated;

grant execute on function public.replace_superlative_votes(integer, integer, integer[], jsonb) to service_role;
grant execute on function public.save_survey_response(integer, integer, jsonb) to service_role;
