-- weapon_category superseded by weapon (#474): every player_match_weapon_stats row now has weapon
-- populated (confirmed via a full demo reparse across every match with a demo), so the stored
-- category and its role as a not-null fallback are no longer needed. The weapon-class rollup
-- (pistol/smg/rifle/sniper/shotgun) is derived from weapon at query time instead
-- (WEAPON_CATEGORY[weapon], resolveWeaponAndCategory() in src/lib/queries/weaponStats.ts).

alter table public.player_match_weapon_stats
  alter column weapon set not null,
  drop column weapon_category;
