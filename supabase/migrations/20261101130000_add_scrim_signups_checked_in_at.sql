-- When a player checked in on the night itself (`null` = not checked in). Matchmaking only draws from
-- checked-in players; checking in also makes the signup `definite`.
alter table public.scrim_signups add column checked_in_at timestamptz;
