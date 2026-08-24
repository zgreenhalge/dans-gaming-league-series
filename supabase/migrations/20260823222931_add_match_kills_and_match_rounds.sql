-- Granular per-event fact tables for demo-derived kill and round data (#452, #453). One row per
-- kill / round outcome, not a per-player pre-aggregate — category rollups, favorite weapon, and
-- round-win% by side are computed at query time from these.

create table public.match_kills (
  id bigint primary key generated always as identity,
  match_id bigint not null,
  round_number integer not null,
  attacker_player_match_stats_id bigint,
  victim_player_match_stats_id bigint not null,
  assister_player_match_stats_id bigint,
  weapon text not null,
  headshot boolean not null default false,
  is_teamkill boolean not null default false,
  tick integer not null,
  unique (match_id, round_number, victim_player_match_stats_id)
);

alter table public.match_kills
  add constraint match_kills_match_id_fkey foreign key (match_id) references public.matches(id) on delete cascade;
alter table public.match_kills
  add constraint match_kills_attacker_fkey foreign key (attacker_player_match_stats_id) references public.player_match_stats(id) on delete cascade;
alter table public.match_kills
  add constraint match_kills_victim_fkey foreign key (victim_player_match_stats_id) references public.player_match_stats(id) on delete cascade;
alter table public.match_kills
  add constraint match_kills_assister_fkey foreign key (assister_player_match_stats_id) references public.player_match_stats(id) on delete cascade;

create table public.match_rounds (
  id bigint primary key generated always as identity,
  match_id bigint not null,
  round_number integer not null,
  winner_side text not null,
  shirts_side text not null,
  win_reason text,
  unique (match_id, round_number)
);

alter table public.match_rounds
  add constraint match_rounds_match_id_fkey foreign key (match_id) references public.matches(id) on delete cascade;
