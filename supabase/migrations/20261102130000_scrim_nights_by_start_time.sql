-- Scrim nights by start time. A night is a `scrim_nights` row with its start instant, created by its
-- first signup (`start_scrim_night()`) and removed when its last player drops out while it has no
-- matches (`leave_scrim_night()`). Called from src/lib/scrim-nights.ts.

drop table public.scrim_schedule;

alter table public.scrim_nights
  drop column night_date,
  drop column cancelled,
  add column starts_at timestamptz not null;
create index scrim_nights_starts_at_idx on public.scrim_nights using btree (starts_at);

-- Starts a night at `p_starts_at` with `p_player_id` as its first signup. Locks the table against
-- other writes so two concurrent starts can't both pass the overlap check, and refuses a start within
-- `p_night_minutes` of another night's (the nights would overlap on the one shared server). Returns
-- the new night id.
create or replace function public.start_scrim_night(
  p_starts_at timestamptz,
  p_night_minutes integer,
  p_player_id integer,
  p_commitment text
)
returns integer
language plpgsql
set search_path = public
as $function$
declare
  v_night_id integer;
  v_length interval := make_interval(mins => p_night_minutes);
begin
  lock table scrim_nights in share row exclusive mode;
  if exists (select 1 from scrim_nights where starts_at > p_starts_at - v_length and starts_at < p_starts_at + v_length) then
    raise exception 'overlapping-scrim-night' using errcode = 'P0001';
  end if;
  insert into scrim_nights (starts_at) values (p_starts_at) returning id into v_night_id;
  insert into scrim_signups (night_id, player_id, commitment) values (v_night_id, p_player_id, p_commitment);
  return v_night_id;
end;
$function$;

-- Drops `p_player_id` from a night, and removes the night once nobody is signed up and it has no
-- matches. Row-locks the night, so a concurrent signup (whose foreign key check takes a share lock on
-- it) either lands first and keeps the night, or waits and fails against the removed one. Returns
-- whether the night was removed.
create or replace function public.leave_scrim_night(
  p_night_id integer,
  p_player_id integer
)
returns boolean
language plpgsql
set search_path = public
as $function$
begin
  perform 1 from scrim_nights where id = p_night_id for update;
  if not found then
    raise exception 'Scrim night % not found', p_night_id;
  end if;
  delete from scrim_signups where night_id = p_night_id and player_id = p_player_id;
  if exists (select 1 from scrim_signups where night_id = p_night_id)
     or exists (select 1 from matches where scrim_night_id = p_night_id) then
    return false;
  end if;
  delete from scrim_nights where id = p_night_id;
  return true;
end;
$function$;
