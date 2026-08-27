-- #457 step 1: additive-only. Gives player_match_weapon_stats/player_match_economy_stats a
-- match_id column so weaponStats.ts can use factTables.ts's replaceMatchRows() instead of its
-- bespoke delete+insert, and adds match_utility_throws/match_round_economy as new granular fact
-- tables alongside match_kills/match_rounds. No drops here — old columns/behavior stay live until
-- the query layer reads from these and historical matches are backfilled via reparse.

alter table public.player_match_weapon_stats add column match_id bigint;
update public.player_match_weapon_stats w
  set match_id = pms.match_id
  from public.player_match_stats pms
  where pms.id = w.player_match_stats_id;
alter table public.player_match_weapon_stats alter column match_id set not null;
alter table public.player_match_weapon_stats
  add constraint player_match_weapon_stats_match_id_fkey foreign key (match_id) references public.matches(id) on delete cascade;
create index player_match_weapon_stats_match_id_idx on public.player_match_weapon_stats using btree (match_id);

alter table public.player_match_economy_stats add column match_id bigint;
update public.player_match_economy_stats e
  set match_id = pms.match_id
  from public.player_match_stats pms
  where pms.id = e.player_match_stats_id;
alter table public.player_match_economy_stats alter column match_id set not null;
alter table public.player_match_economy_stats
  add constraint player_match_economy_stats_match_id_fkey foreign key (match_id) references public.matches(id) on delete cascade;
create index player_match_economy_stats_match_id_idx on public.player_match_economy_stats using btree (match_id);

create table public.match_utility_throws (
  id bigint primary key generated always as identity,
  match_id bigint not null,
  round_number integer not null,
  flasher_player_match_stats_id bigint not null,
  blinded_player_match_stats_id bigint not null,
  blind_duration real not null,
  tick integer not null
);

alter table public.match_utility_throws
  add constraint match_utility_throws_match_id_fkey foreign key (match_id) references public.matches(id) on delete cascade;
alter table public.match_utility_throws
  add constraint match_utility_throws_flasher_fkey foreign key (flasher_player_match_stats_id) references public.player_match_stats(id) on delete cascade;
alter table public.match_utility_throws
  add constraint match_utility_throws_blinded_fkey foreign key (blinded_player_match_stats_id) references public.player_match_stats(id) on delete cascade;
create index match_utility_throws_match_id_idx on public.match_utility_throws using btree (match_id);

create table public.match_round_economy (
  id bigint primary key generated always as identity,
  match_id bigint not null,
  round_number integer not null,
  player_match_stats_id bigint not null,
  economy_type text not null,
  equipment_value integer not null,
  unique (match_id, round_number, player_match_stats_id)
);

alter table public.match_round_economy
  add constraint match_round_economy_match_id_fkey foreign key (match_id) references public.matches(id) on delete cascade;
alter table public.match_round_economy
  add constraint match_round_economy_player_fkey foreign key (player_match_stats_id) references public.player_match_stats(id) on delete cascade;
