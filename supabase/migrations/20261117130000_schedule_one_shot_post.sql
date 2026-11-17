-- One generic one-shot scheduler for the app's pg_cron jobs. `schedule_one_shot_post()` queues a job
-- for the first whole minute at or after `p_fire_at` (cron fires on the minute, so a job never fires
-- before its time) that `POST`s `p_path` (a route under the site) with `p_body` and a
-- `CRON_SECRET` bearer token, then unschedules itself (cron has no year field, so it would otherwise
-- recur annually). A job of the same name queued before is replaced. A time that is already due queues
-- nothing and succeeds. Returns true when the job is queued or none is due, false when scheduling
-- stopped early because the `cron_secret` Vault secret is missing.
--
-- The job re-reads the Vault secret when it fires rather than embedding it in the command, so a
-- CRON_SECRET rotation is picked up and the token never sits in cron.job.command.
create or replace function public.schedule_one_shot_post(
  p_job_name text,
  p_path text,
  p_body jsonb,
  p_fire_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_site_url text := 'https://dans-gaming-league-series.vercel.app'; -- keep in sync with SITE_URL (src/lib/seo/site.ts)
  v_fire_minute timestamptz := date_trunc('minute', p_fire_at + interval '1 minute' - interval '1 microsecond');
begin
  begin
    perform cron.unschedule(p_job_name);
  exception when others then
    null; -- no job of this name queued yet — expected on first schedule
  end;

  if p_fire_at <= now() then
    return true;
  end if;

  if not exists (select 1 from vault.decrypted_secrets where name = 'cron_secret') then
    return false;
  end if;

  -- 5-field cron expression for that one minute this year ("MI HH24 DD MM *").
  perform cron.schedule(
    p_job_name,
    to_char(v_fire_minute at time zone 'utc', 'MI HH24 DD MM') || ' *',
    format(
      $sql$
      select net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization',
          'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1)),
        body := %L::jsonb
      );
      select cron.unschedule(%L);
      $sql$,
      v_site_url || p_path,
      p_body::text,
      p_job_name
    )
  );
  return true;
end;
$function$;

revoke execute on function public.schedule_one_shot_post(text, text, jsonb, timestamptz) from public, anon, authenticated;

-- A night's "1 hour out" reminder is one such job, fired at `starts_at - 1 hour`.
create or replace function public.schedule_scrim_night_reminder(
  p_night_id integer,
  p_starts_at timestamptz
)
returns boolean
language sql
security definer
set search_path = ''
as $function$
  select public.schedule_one_shot_post(
    format('scrim_reminder_%s', p_night_id),
    '/api/cron/scrim-reminder',
    jsonb_build_object('nightId', p_night_id),
    p_starts_at - interval '1 hour'
  );
$function$;

revoke execute on function public.schedule_scrim_night_reminder(integer, timestamptz) from public, anon, authenticated;
