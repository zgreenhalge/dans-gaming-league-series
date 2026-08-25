-- Kill-feed modifier flags on `match_kills` (#465): no-scope, wallbang (bullet penetration), and
-- blind-kill, tracked alongside the existing `headshot` flag so they can be aggregated the same way.

alter table public.match_kills
  add column noscope boolean not null default false,
  add column wallbang boolean not null default false,
  add column blind_kill boolean not null default false;
