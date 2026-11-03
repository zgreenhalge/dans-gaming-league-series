-- Every scrim match is created through `queue_scrim_matches()`: an ad-hoc match is a queue of one.
drop function public.create_scrim_match(integer, text, text, integer[], integer[]);
