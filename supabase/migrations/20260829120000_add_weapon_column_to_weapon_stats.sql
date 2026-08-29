-- #474 phase 1: additive-only. Adds player_match_weapon_stats.weapon (the exact per-weapon
-- classname, e.g. "ak47") alongside the existing weapon_category column, so the Weapons sub-tab
-- can show accuracy/damage for a favorite or specifically-selected weapon, not just a whole
-- category. weapon_category stays NOT NULL and is still written on every insert (now derived from
-- weapon) until the query layer's read side and every historical match are confirmed migrated via
-- reparse — matching #457's own two-phase precedent (20260827214113 / 20260828015325). A later,
-- separate migration drops weapon_category once that's confirmed safe.

alter table public.player_match_weapon_stats add column weapon text;

alter table public.player_match_weapon_stats
  add constraint player_match_weapon_stats_pms_weapon_key unique (player_match_stats_id, weapon);
