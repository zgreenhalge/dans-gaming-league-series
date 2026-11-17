import { NextRequest } from 'next/server';
import { handleCronPost } from '@/lib/cron-route';
import { syncScrimNightMessage } from '@/lib/discord-scrim-notify';

/** Fired by a one-shot Postgres pg_cron job (`schedule_one_shot_post()`) at the instant a scrim night
 *  would end on the clock, so its message turns to the final standings without anyone pressing End night
 *  — see `scheduleScrimNightEndSync()` in `discord-scrim-notify.ts`. It runs `syncScrimNightMessage()`,
 *  which is a plain edit when later activity has pushed the end back. */
export const POST = (req: NextRequest) => handleCronPost(req, 'nightId', syncScrimNightMessage);
