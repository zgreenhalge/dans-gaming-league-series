import { NextRequest } from 'next/server';
import { handleCronPost } from '@/lib/cron-route';
import { notifyScrimNightReminder } from '@/lib/discord-scrim-notify';

/** Fired once per scrim night, an hour before its start, by a one-shot Postgres pg_cron job
 *  (`schedule_scrim_night_reminder()`), as `POST /api/cron/match-reminder` is for a match — see
 *  `scheduleScrimNightReminder()` in `discord-scrim-notify.ts`. Every staleness and idempotency guard
 *  belongs to `notifyScrimNightReminder()`. */
export const POST = (req: NextRequest) => handleCronPost(req, 'nightId', notifyScrimNightReminder);
