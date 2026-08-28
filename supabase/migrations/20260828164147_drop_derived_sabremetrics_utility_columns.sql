alter table public.player_match_sabremetrics
  drop column flash_assists,
  drop column teamflash_duration,
  drop column enemies_flashed,
  drop column flashes_leading_to_kill,
  drop column effective_flashes,
  drop column blind_duration_dealt,
  drop column blind_duration_max_sum;
