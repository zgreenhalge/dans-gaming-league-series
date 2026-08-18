-- ─── Extensions ─────────────────────────────────────────────────────────────────

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ─── Match reminder scheduling (#395) ────────────────────────────────────────────

-- Schedules (or cancels/reschedules) the one-shot Discord "1 hour out" reminder for a match,
-- called by the app immediately after PATCH /api/matches/[id]/schedule writes matches.scheduled_at
-- — the only write path for that column. Scheduling logic deliberately lives here, called
-- explicitly from the app layer, rather than behind a trigger on matches, so it stays visible at
-- the one call site that owns scheduled_at.
--
-- Always unschedules any existing pg_cron job for this match first, whether p_scheduled_at is a new
-- time, an unchanged time (re-saved), or null (cleared) — a stale pending job must never survive a
-- reschedule or an unschedule. Also always resets match_discord_state.reminder_sent_at to null: a
-- reminder already sent for an earlier scheduled time must not suppress a genuinely new reminder for
-- a new time (notifyMatchReminder() keys its idempotency off this column).
--
-- Past-due (p_scheduled_at - 1h already <= now(), e.g. an admin schedules a match 30 minutes out):
-- fires the reminder immediately via pg_net rather than silently skipping it or scheduling a
-- pg_cron job for a wall-clock minute that has already passed (which would never run today, and
-- would wrongly recur on the same day/month next year — cron fields have no year field).
--
-- The scheduled job's command re-reads the Vault secret at fire time rather than embedding it in
-- the command string, so a CRON_SECRET rotation is picked up without rescheduling every pending
-- job, and the raw bearer token never sits in cleartext in cron.job.command.
create or replace function public.schedule_match_reminder(
  p_match_id integer,
  p_scheduled_at timestamptz
)
returns void
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
    return; -- unscheduled — nothing further to do
  end if;

  v_reminder_at := p_scheduled_at - interval '1 hour';

  select decrypted_secret into v_cron_secret
  from vault.decrypted_secrets
  where name = 'cron_secret'
  limit 1;

  if v_cron_secret is null then
    insert into public.ops_errors (entity_type, entity_id, operation, message, occurred_at, dismissed_at)
    values ('match', p_match_id, 'discord_notify_reminder',
            'Vault secret "cron_secret" is not configured — cannot schedule match reminder', now(), null)
    on conflict (entity_type, entity_id, operation)
    do update set message = excluded.message, occurred_at = excluded.occurred_at, dismissed_at = null;
    return;
  end if;

  if v_reminder_at <= now() then
    perform net.http_post(
      url := v_site_url || '/api/cron/match-reminder',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_cron_secret),
      body := jsonb_build_object('matchId', p_match_id)
    );
    return;
  end if;

  -- 5-field cron expr for one exact minute this year: "MI HH DD MM *". No year field exists in
  -- cron syntax, so the job's own command unschedules itself right after firing (below) — otherwise
  -- it would silently recur on the same day/month every year.
  v_cron_expr := to_char(v_reminder_at at time zone 'utc', 'MI HH DD MM') || ' *';

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
end;
$function$;
