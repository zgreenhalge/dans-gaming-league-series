-- Survey and superlatives admin writes whose check and write, or several writes, must land together.
-- Each function runs as one Postgres transaction, so a failure part-way leaves the stored state
-- unchanged. Only the service role may execute them.

-- Replaces a survey's questions with `p_questions`, and opens it too when `p_open` is true — but
-- only while the survey is unlocked: closed, with no response. Returns whether the questions were
-- saved; false means the survey is locked (or does not exist) and nothing changed. The lock check
-- and the write are one statement, so a reopen or a response that lands between the caller's own
-- read and this call is never overwritten.
create or replace function public.replace_survey_questions(
  p_survey_id integer,
  p_questions jsonb,
  p_open boolean
)
returns boolean
language plpgsql
set search_path = ''
as $function$
begin
  update public.surveys
  set questions = p_questions,
      closed_at = case when p_open then null else closed_at end
  where id = p_survey_id
    and closed_at is not null
    and not exists (select 1 from public.survey_responses r where r.survey_id = p_survey_id);
  return found;
end;
$function$;

-- Admin reset of a survey: closes it and deletes every response, keeping the questions.
create or replace function public.reset_survey(p_survey_id integer)
returns void
language plpgsql
set search_path = ''
as $function$
begin
  update public.surveys set closed_at = now() where id = p_survey_id;
  delete from public.survey_responses where survey_id = p_survey_id;
end;
$function$;

-- Admin reset of a season's superlatives vote: closes voting and deletes every vote cast on the
-- season's superlatives, keeping the superlatives.
create or replace function public.reset_superlative_votes(p_season_id integer)
returns void
language plpgsql
set search_path = ''
as $function$
begin
  update public.superlative_polls set is_open = false where season_id = p_season_id;
  delete from public.superlative_votes v
  using public.superlatives s
  where v.superlative_id = s.id and s.season_id = p_season_id;
end;
$function$;

revoke all on function public.replace_survey_questions(integer, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.reset_survey(integer) from public, anon, authenticated;
revoke all on function public.reset_superlative_votes(integer) from public, anon, authenticated;

grant execute on function public.replace_survey_questions(integer, jsonb, boolean) to service_role;
grant execute on function public.reset_survey(integer) to service_role;
grant execute on function public.reset_superlative_votes(integer) to service_role;
