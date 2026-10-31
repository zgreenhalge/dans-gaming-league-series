import { getAdminClient } from '../supabase-admin';
import {
  normalizeStartTime,
  scrimNightSlots,
  nextScrimNight,
  type ScrimCommitment,
  type ScrimNightRow,
  type ScrimNightSlot,
  type ScrimSchedule,
} from '../scrim-schedule';
import { persistentQuery } from './_persistentCache';
import { getPlayersById } from './player';

export interface ScrimSignupEntry {
  player_id: number;
  player_name: string;
  steam_avatar_url: string | null;
  commitment: ScrimCommitment;
  signed_up_at: string;
}

/** The weekly scrim slot, or `null` before an admin has set one. */
export const getScrimSchedule = persistentQuery('getScrimSchedule', async (): Promise<ScrimSchedule | null> => {
  const { data, error } = await getAdminClient()
    .from('scrim_schedule')
    .select('weekday, start_time, timezone, enabled')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as { weekday: number; start_time: string; timezone: string; enabled: boolean };
  return { weekday: row.weekday, startTime: normalizeStartTime(row.start_time), timezone: row.timezone, enabled: row.enabled };
});

/** Every `scrim_nights` row — one per date anyone has signed up for or an admin has cancelled. */
export const getScrimNightRows = persistentQuery('getScrimNightRows', async (): Promise<ScrimNightRow[]> => {
  const { data, error } = await getAdminClient().from('scrim_nights').select('id, night_date, cancelled');
  if (error) throw error;
  return (data ?? []) as ScrimNightRow[];
});

/** A night's signups: definite before maybe, then in signup order. A signup whose player row is
 *  missing is omitted, as in `getSeasonRoster()`. */
export const getScrimSignups = persistentQuery('getScrimSignups', async (nightId: number): Promise<ScrimSignupEntry[]> => {
  const [{ data, error }, playersById] = await Promise.all([
    getAdminClient().from('scrim_signups').select('player_id, commitment, signed_up_at').eq('night_id', nightId),
    getPlayersById(),
  ]);
  if (error) throw error;

  const entries: ScrimSignupEntry[] = [];
  for (const r of (data ?? []) as { player_id: number; commitment: ScrimCommitment; signed_up_at: string }[]) {
    const player = playersById.get(r.player_id);
    if (!player) continue;
    entries.push({ ...r, player_name: player.name, steam_avatar_url: player.steam_avatar_url });
  }
  const rank = (c: ScrimCommitment) => (c === 'definite' ? 0 : 1);
  return entries.sort((a, b) => rank(a.commitment) - rank(b.commitment) || a.signed_up_at.localeCompare(b.signed_up_at));
});

/** The schedule and the nights that haven't ended yet (`scrimNightSlots()`) as of `now`. */
export async function getScrimNights(now: Date): Promise<{ schedule: ScrimSchedule | null; slots: ScrimNightSlot[] }> {
  const [schedule, rows] = await Promise.all([getScrimSchedule(), getScrimNightRows()]);
  return { schedule, slots: scrimNightSlots(schedule, rows, now) };
}

export interface ScrimOverview {
  schedule: ScrimSchedule | null;
  /** Nights that haven't ended yet, cancelled ones included. */
  slots: ScrimNightSlot[];
  /** The next night that isn't cancelled. */
  next: ScrimNightSlot | null;
  /** `next`'s signups (empty while it has no `scrim_nights` row). */
  signups: ScrimSignupEntry[];
}

/** Everything the scrims page and the home page's Next Scrims card show, as of `now`. */
export async function getScrimOverview(now: Date): Promise<ScrimOverview> {
  const { schedule, slots } = await getScrimNights(now);
  const next = nextScrimNight(slots);
  const signups = next?.nightId != null ? await getScrimSignups(next.nightId) : [];
  return { schedule, slots, next, signups };
}
