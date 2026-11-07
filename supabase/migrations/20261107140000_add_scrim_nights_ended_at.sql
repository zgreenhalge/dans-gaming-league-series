-- A scrim night ends on the clock (`scrim_nights.starts_at` plus the night's length) or earlier, when a
-- player or an admin ends it: `ended_at` is that moment. Null while the night runs to the clock.
-- Written by src/lib/scrim-nights.ts (`endScrimNight()`); read by `hasScrimNightEnded()`.

alter table public.scrim_nights add column ended_at timestamptz;
