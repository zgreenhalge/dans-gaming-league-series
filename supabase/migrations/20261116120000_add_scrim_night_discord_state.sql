-- Discord messages for scrim nights (src/lib/discord-scrim-notify.ts), mirroring `match_discord_state`
-- for league matches. One row per night; it goes with the night (`on delete cascade`).
--   announcement_message_id  the message posted when the night was scheduled; deleted when the
--                            reminder posts
--   reminder_message_id      the message posted an hour before the start, edited in place from then
--                            on: roster, the latest match's score, and the night's final standings
--   reminder_sent_at         claimed atomically before the reminder posts, so it never posts twice
--   finalized_at             set once the message shows the ended night's final standings; cleared
--                            if the night is reopened
create table public.scrim_night_discord_state (
  night_id integer primary key references public.scrim_nights(id) on delete cascade,
  announcement_message_id text,
  reminder_message_id text,
  reminder_sent_at timestamptz,
  finalized_at timestamptz
);

alter table public.scrim_night_discord_state enable row level security;

create constraint trigger bump_data_version after insert or update or delete on public.scrim_night_discord_state
  deferrable initially deferred for each row execute function public.bump_data_version();

-- Schedules the one-shot "1 hour out" Discord reminder for a night, the way
-- `schedule_match_reminder()` does for a match: a pg_cron job for the exact minute that POSTs
-- /api/cron/scrim-reminder and then unschedules itself. A night's start never changes, so this runs
-- once, when the night is created. A start within the hour schedules nothing: the app posts the
-- reminder straight away instead of an announcement. Returns true when the reminder is scheduled or
-- none is due, false when scheduling stopped early because the `cron_secret` Vault secret is missing.
--
-- The job re-reads the Vault secret when it fires rather than embedding it in the command, so a
-- CRON_SECRET rotation is picked up and the token never sits in cron.job.command.
create or replace function public.schedule_scrim_night_reminder(
  p_night_id integer,
  p_starts_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job_name text := format('scrim_reminder_%s', p_night_id);
  v_site_url text := 'https://dans-gaming-league-series.vercel.app'; -- keep in sync with SITE_URL (src/lib/seo/site.ts)
  v_reminder_at timestamptz := p_starts_at - interval '1 hour';
begin
  begin
    perform cron.unschedule(v_job_name);
  exception when others then
    null; -- no job existed yet for this night — expected on first schedule
  end;

  if v_reminder_at <= now() then
    return true;
  end if;

  if not exists (select 1 from vault.decrypted_secrets where name = 'cron_secret') then
    return false;
  end if;

  -- 5-field cron expression for one exact minute this year ("MI HH24 DD MM *"); the job
  -- unschedules itself after firing since cron has no year field.
  perform cron.schedule(
    v_job_name,
    to_char(v_reminder_at at time zone 'utc', 'MI HH24 DD MM') || ' *',
    format(
      $sql$
      select net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization',
          'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1)),
        body := jsonb_build_object('nightId', %s)
      );
      select cron.unschedule(%L);
      $sql$,
      v_site_url || '/api/cron/scrim-reminder',
      p_night_id,
      v_job_name
    )
  );
  return true;
end;
$function$;

revoke execute on function public.schedule_scrim_night_reminder(integer, timestamptz) from public, anon, authenticated;
