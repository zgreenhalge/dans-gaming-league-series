-- Granular per-event fact table for demo-derived damage (#491). One row per `player_hurt` event,
-- same grain and "downstream queries decide" convention as `match_kills`/`match_utility_throws` —
-- self-damage and teamdamage are kept rather than filtered, and `attacker_player_match_stats_id` is
-- nullable for hits with no resolvable attacker (world/fall damage). Unlike `match_kills`, there is
-- no natural per-round uniqueness (a player can be hit any number of times in a round), so no
-- unique constraint beyond the identity primary key.

create table public.match_damage_events (
  id bigint primary key generated always as identity,
  match_id bigint not null,
  round_number integer not null,
  attacker_player_match_stats_id bigint,
  victim_player_match_stats_id bigint not null,
  weapon text not null,
  damage integer not null,
  hitgroup text not null,
  tick integer not null
);

alter table public.match_damage_events
  add constraint match_damage_events_match_id_fkey foreign key (match_id) references public.matches(id) on delete cascade;
alter table public.match_damage_events
  add constraint match_damage_events_attacker_fkey foreign key (attacker_player_match_stats_id) references public.player_match_stats(id) on delete cascade;
alter table public.match_damage_events
  add constraint match_damage_events_victim_fkey foreign key (victim_player_match_stats_id) references public.player_match_stats(id) on delete cascade;
create index match_damage_events_match_id_idx on public.match_damage_events using btree (match_id);
