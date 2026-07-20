// Derives who is currently connected to the shared DatHost server from its raw console log.
// DatHost's `players_online` (see `dathost.ts`) is a bare count with no roster, and there's no
// dedicated "list connected players" endpoint — but every connect/disconnect/round event the game
// logs already carries `"name<userid><steamid><team>"`, so the current roster can be recovered
// without storing anything ourselves. Lines are processed oldest-first (the order `getConsoleLines`
// returns them in): the last event per userid — connected or disconnected — wins.

export interface ConnectedPlayer {
  name: string;
  /** Steam3 id (e.g. `[U:1:12345]`) — `null` if only ever seen mid-connect (`STEAM_ID_PENDING`). */
  steamId: string | null;
}

const PLAYER_TOKEN_RE = /"([^"<]+)<(\d+)><([^>]*)><[^>]*>"/g;

/**
 * Echoed to the console right after boot (see `/api/scrim/start`) so `linesSinceMarker` can discard
 * everything before it. The server is reused (never deleted, see `dathost.ts`), and stopping/starting
 * it doesn't clear its console log — so without this, a stale "connected" line from whatever last used
 * the box (a previous scrim, a real match, a leftover test) with no matching "disconnected" line after
 * it reads as a currently-connected phantom player until a real connection happens to reuse the same
 * `userid` slot and overwrite it.
 */
export const SCRIM_BOOT_MARKER = 'DGLS-SCRIM-BOOT';

/**
 * `lines` (oldest first, as `getConsoleLines` returns them) from the last occurrence of `marker`
 * onward, discarding everything before it — or all of `lines` if `marker` isn't present in the
 * window at all (it scrolled out of the ~1000-line window, which can only happen once everything
 * before it has *also* scrolled out, so falling back to "trust everything" is still safe then).
 */
export function linesSinceMarker(lines: string[], marker: string): string[] {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].includes(marker)) return lines.slice(i + 1);
  }
  return lines;
}

/** Best-effort currently-connected roster from a window of raw console lines (oldest first). */
export function parseConnectedPlayers(lines: string[]): ConnectedPlayer[] {
  const byUserId = new Map<string, { name: string; steamId: string | null; connected: boolean }>();

  for (const line of lines) {
    PLAYER_TOKEN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PLAYER_TOKEN_RE.exec(line))) {
      const [, name, userId, steamIdRaw] = m;
      if (name === 'SourceTV' || steamIdRaw === 'BOT') continue;
      const disconnected = /\bdisconnected\b/.test(line);
      const existing = byUserId.get(userId);
      const steamId = steamIdRaw === 'STEAM_ID_PENDING' ? (existing?.steamId ?? null) : steamIdRaw;
      byUserId.set(userId, { name, steamId, connected: !disconnected });
    }
  }

  const players: ConnectedPlayer[] = [];
  for (const p of byUserId.values()) {
    if (p.connected) players.push({ name: p.name, steamId: p.steamId });
  }
  return players;
}
