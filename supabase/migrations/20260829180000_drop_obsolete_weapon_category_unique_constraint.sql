-- player_match_weapon_stats stores one row per exact weapon now (unique on
-- (player_match_stats_id, weapon), added in 20260829120000), so a player using more than one
-- weapon in the same category (e.g. ak47 and m4a4, both weapon_category = 'rifle') legitimately
-- produces multiple rows sharing weapon_category. The category-level uniqueness constraint from
-- the init schema conflicts with that and must go.

alter table public.player_match_weapon_stats
  drop constraint player_match_weapon_stats_player_match_stats_id_weapon_cate_key;
