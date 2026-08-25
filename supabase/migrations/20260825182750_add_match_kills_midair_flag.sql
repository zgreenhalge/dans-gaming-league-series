-- Mid-air kill flag on `match_kills` (#465 follow-up): the attacker was airborne (jumping, not
-- touching a surface) at the moment of the kill, tracked alongside the existing
-- headshot/noscope/wallbang/blind_kill flags.

alter table public.match_kills
  add column midair boolean not null default false;
