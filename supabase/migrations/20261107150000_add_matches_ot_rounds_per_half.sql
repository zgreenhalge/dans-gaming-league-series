-- Rounds per overtime half (`mp_overtime_maxrounds / 2`) for a match, inferred from its demo's
-- mid-period side swap. Null until a demo with overtime has been parsed; readers treat null as the
-- default half size.
alter table public.matches
  add column ot_rounds_per_half smallint check (ot_rounds_per_half > 0);
