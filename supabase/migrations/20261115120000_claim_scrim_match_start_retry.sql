-- Claims a scrim match's start: bumps its revision, so a change or discard sent from the version
-- before the start is refused. The provision route calls it after its own checks, just before the
-- server boots. Returns the new revision.
--
-- A start whose boot failed (`match_server_state` is `failed`) is claimed again from the match's
-- current revision, whatever `p_revision` is (null included): the failed claim already bumped the
-- revision and nothing is running that a stale client could clobber, so a retry never needs to know
-- the revision the failed start left. Any other start needs `p_revision` to be current.
--
-- Claiming from `failed` also sets the state to `provisioning`, under the same lock, so a second
-- retry racing the first finds the match already starting and is refused rather than booting it twice.
--
-- Refuses with `scrim-match-locked` once the match has a score or is already starting or running
-- (`provisioning`, `live`, `tearing_down`, `done`; the same rule as `update_scrim_match()`).
create or replace function public.claim_scrim_match_start(p_match_id integer, p_revision integer default null)
returns integer
language plpgsql
set search_path = public
as $function$
declare
  v_scrim_night_id integer;
  v_revision integer;
  v_final_score text;
  v_state text;
  v_revision_new integer;
begin
  select scrim_night_id, scrim_revision, final_score into v_scrim_night_id, v_revision, v_final_score
  from matches where id = p_match_id for update;
  if not found then
    raise exception 'scrim-match-changed' using errcode = 'P0001';
  end if;
  if v_scrim_night_id is null then
    raise exception 'Match % is not a scrim match', p_match_id;
  end if;
  select server_state into v_state from match_server_state where match_id = p_match_id;
  if v_state is distinct from 'failed' and (p_revision is null or v_revision <> p_revision) then
    raise exception 'scrim-match-changed' using errcode = 'P0001';
  end if;
  if v_final_score is not null or v_state in ('provisioning', 'live', 'tearing_down', 'done') then
    raise exception 'scrim-match-locked' using errcode = 'P0001';
  end if;
  if v_state = 'failed' then
    update match_server_state set server_state = 'provisioning' where match_id = p_match_id;
  end if;
  update matches set scrim_revision = scrim_revision + 1 where id = p_match_id
  returning scrim_revision into v_revision_new;
  return v_revision_new;
end;
$function$;
