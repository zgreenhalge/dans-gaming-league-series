-- Schedules (or cancels/reschedules) the one-shot Discord "1 hour out" reminder for a match — see
-- the original definition's comment for the full design. This redefinition fixes two bugs in that
-- version:
--
-- 1. The cron-expression builder used to_char's 'HH' (12-hour clock, 01-12) instead of 'HH24'
--    (00-23), so a reminder time in the afternoon/evening/midnight UTC hour was scheduled 12 hours
--    off from the intended minute.
-- 2. Returns `boolean` (true = fully scheduled or intentionally unscheduled; false = the unconditional
--    cleanup ran but scheduling itself stopped early, e.g. a missing Vault secret) instead of `void`.
--    The caller (PATCH /api/matches/[id]/schedule/route.ts) needs to distinguish "the RPC call
--    didn't error" from "scheduling actually succeeded" — a `void`-returning function that records
--    its own ops_errors row on the Vault-secret-missing path but still returns normally left the
--    caller with no way to avoid immediately clearing that same error it was just told about.
--
-- Vault-secret-missing (and any other stop-early case) records under 'discord_schedule_reminder' —
-- distinct from notifyMatchReminder()'s 'discord_notify_reminder' — since a failure to *schedule*
-- the reminder and a failure to *deliver* it are different problems with different fixes, and
-- ops_errors keys by (entity_type, entity_id, operation) specifically so one's success can't
-- silently clear the other's still-live error for the same match.
create or replace function public.schedule_match_reminder(
  p_match_id integer,
  p_scheduled_at timestamptz
)
returns boolean
language plpgsql
as $function$
declare
  v_job_name text := format('match_reminder_%s', p_match_id);
  v_site_url text := 'https://dans-gaming-league-series.vercel.app'; -- keep in sync with SITE_URL (src/lib/seo/site.ts)
  v_reminder_at timestamptz;
  v_cron_secret text;
  v_cron_expr text;
begin
  begin
    perform cron.unschedule(v_job_name);
  exception when others then
    null; -- no job existed yet for this match — expected on first schedule
  end;

  insert into public.match_discord_state (match_id, reminder_sent_at)
  values (p_match_id, null)
  on conflict (match_id) do update set reminder_sent_at = null;

  if p_scheduled_at is null then
    return true; -- unscheduled — nothing further to do
  end if;

  v_reminder_at := p_scheduled_at - interval '1 hour';

  select decrypted_secret into v_cron_secret
  from vault.decrypted_secrets
  where name = 'cron_secret'
  limit 1;

  if v_cron_secret is null then
    insert into public.ops_errors (entity_type, entity_id, operation, message, occurred_at, dismissed_at)
    values ('match', p_match_id, 'discord_schedule_reminder',
            'Vault secret "cron_secret" is not configured — cannot schedule match reminder', now(), null)
    on conflict (entity_type, entity_id, operation)
    do update set message = excluded.message, occurred_at = excluded.occurred_at, dismissed_at = null;
    return false;
  end if;

  if v_reminder_at <= now() then
    perform net.http_post(
      url := v_site_url || '/api/cron/match-reminder',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_cron_secret),
      body := jsonb_build_object('matchId', p_match_id)
    );
    return true;
  end if;

  -- 5-field cron expr for one exact minute this year: "MI HH24 DD MM *". No year field exists in
  -- cron syntax, so the job's own command unschedules itself right after firing (below) — otherwise
  -- it would silently recur on the same day/month every year.
  v_cron_expr := to_char(v_reminder_at at time zone 'utc', 'MI HH24 DD MM') || ' *';

  perform cron.schedule(
    v_job_name,
    v_cron_expr,
    format(
      $sql$
      select net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization',
          'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1)),
        body := jsonb_build_object('matchId', %s)
      );
      select cron.unschedule(%L);
      $sql$,
      v_site_url || '/api/cron/match-reminder',
      p_match_id,
      v_job_name
    )
  );
  return true;
end;
$function$;
