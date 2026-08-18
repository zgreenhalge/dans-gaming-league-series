-- schedule_match_reminder()'s "Vault secret missing" case previously recorded under
-- 'discord_notify_reminder' — the same operation key notifyMatchReminder() uses for a real webhook
-- delivery failure. Those are different failures with different fixes (a missing Vault secret is a
-- config problem fixed by re-running the one-time vault.create_secret step; a webhook failure is a
-- Discord/network problem), and ops_errors keys by (entity_type, entity_id, operation) specifically
-- so one's success can't silently clear the other's still-live error for the same match — see
-- ops-errors.ts's own docstring. Moved to 'discord_schedule_reminder', matching the key
-- PATCH /api/matches/[id]/schedule/route.ts now uses for its own scheduling-side RPC failures.
--
-- Everything else about schedule_match_reminder() is unchanged from the original migration — this
-- is a `create or replace`, not a new function, so no re-grant/re-enable step is needed.
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
    values ('match', p_match_id, 'discord_schedule_reminder',
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
