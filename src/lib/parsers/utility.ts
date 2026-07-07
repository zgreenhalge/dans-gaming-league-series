import type { SabFields } from '../types';
import type { MatchContext, PlayerDeathRow } from './matchContext';

type CollectorOut = Map<string, Partial<SabFields>>;

export interface PlayerBlindRow {
  tick: number;
  total_rounds_played: number;
  attacker_steamid: string | null;
  user_steamid: string | null;
  blind_duration: number;
}

export interface WeaponFireRow {
  tick: number;
  total_rounds_played: number;
  user_steamid: string | null;
  weapon: string;
}

export function collectUtility(
  blindEvents: PlayerBlindRow[],
  deathEvents: PlayerDeathRow[],
  fireEvents: WeaponFireRow[],
  context: MatchContext,
  steamIds: string[],
): CollectorOut {
  const out: CollectorOut = new Map();
  const steamSet = new Set(steamIds);
  for (const sid of steamIds) out.set(sid, {});

  const flashAssistWindow = Math.round(3 * context.tickRate);

  // Leetify excludes "half-blind" exposure (< 1.1s) from flash effectiveness stats
  // (enemies_flashed, flash assists). blind_duration_dealt/teamflash_duration stay
  // ungated — they're raw exposure measures, not effectiveness measures.
  const HALF_BLIND_THRESHOLD = 1.1;

  // --- Flash assists, blind_duration_dealt, teamflash_duration ---

  // Build death lookup: steamId → [{tick, round}]
  const deathLookup = new Map<string, { tick: number; round: number; attacker: string | null }[]>();
  for (const d of deathEvents) {
    const round = d.total_rounds_played + 1;
    if (!context.liveRounds.has(round)) continue;
    const victim = d.user_steamid;
    if (!victim || !steamSet.has(victim)) continue;
    if (!deathLookup.has(victim)) deathLookup.set(victim, []);
    deathLookup.get(victim)!.push({ tick: d.tick, round, attacker: d.attacker_steamid });
  }

  for (const b of blindEvents) {
    const round = b.total_rounds_played + 1;
    if (!context.liveRounds.has(round)) continue;

    const flasher = b.attacker_steamid;
    const blinded = b.user_steamid;
    if (!flasher || !steamSet.has(flasher)) continue;
    if (!blinded || !steamSet.has(blinded)) continue;
    if (flasher === blinded) continue; // self-flash ignored for all stats

    const flasherSide = context.playerSides.get(flasher)?.get(round);
    const blindedSide = context.playerSides.get(blinded)?.get(round);
    const isTeammate = flasherSide != null && blindedSide != null && flasherSide === blindedSide;
    const isEnemy = flasherSide != null && blindedSide != null && flasherSide !== blindedSide;
    const duration = b.blind_duration ?? 0;

    const p = out.get(flasher)!;

    if (isEnemy) {
      p.blind_duration_dealt = ((p.blind_duration_dealt as number) ?? 0) + duration;

      if (duration >= HALF_BLIND_THRESHOLD) {
        p.enemies_flashed = ((p.enemies_flashed as number) ?? 0) + 1;

        // Flash assist: enemy is killed by a teammate of the flasher
        // within flashAssistWindow ticks after the blind expires
        const blindExpireTick = b.tick + Math.round(duration * context.tickRate);
        const windowEnd = blindExpireTick + flashAssistWindow;
        const victimDeaths = deathLookup.get(blinded) ?? [];
        const assisted = victimDeaths.some((d) => {
          if (d.round !== round) return false;
          if (d.tick > windowEnd || d.tick < b.tick) return false;
          // Killed by a teammate of the flasher (not the flasher themselves)
          if (!d.attacker || d.attacker === flasher) return false;
          const killerSide = context.playerSides.get(d.attacker)?.get(round);
          return killerSide != null && killerSide === flasherSide;
        });
        if (assisted) {
          p.flash_assists = ((p.flash_assists as number) ?? 0) + 1;
        }
      }
    } else if (isTeammate) {
      p.teamflash_duration = ((p.teamflash_duration as number) ?? 0) + duration;
    }
  }

  // --- Flashes thrown ---
  for (const f of fireEvents) {
    if (f.weapon !== 'weapon_flashbang') continue;
    const round = f.total_rounds_played + 1;
    if (!context.liveRounds.has(round)) continue;
    const thrower = f.user_steamid;
    if (!thrower || !steamSet.has(thrower)) continue;
    const p = out.get(thrower)!;
    p.flashes_thrown = ((p.flashes_thrown as number) ?? 0) + 1;
  }

  return out;
}
