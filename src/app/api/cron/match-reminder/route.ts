import { NextRequest } from 'next/server';
import { handleCronPost } from '@/lib/cron-route';
import { notifyMatchReminder } from '@/lib/discord-notify';

/** Fired once per match by a one-shot Postgres pg_cron job (`schedule_match_reminder()`), not by
 *  Vercel's own cron (which only issues `GET` and is registered in `vercel.json` — this route
 *  deliberately isn't) — see `discord-notify.ts`'s `notifyMatchReminder()` docstring for the full
 *  scheduling chain. Auth, body parsing and the always-200 rule are `handleCronPost()`'s; every
 *  idempotency/staleness guard belongs to `notifyMatchReminder()`. */
export const POST = (req: NextRequest) => handleCronPost(req, 'matchId', notifyMatchReminder);
