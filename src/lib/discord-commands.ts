// Discord slash command handlers (#396) — /leaderboard, /scheduled, /player. Each returns a
// Discord interaction-response object; the route (src/app/api/discord/interactions/route.ts) is
// the only caller, and owns request verification and dispatch by command name.

import {
  getActiveRegularSeason,
  getSeasons,
  getSeasonSchedule,
  findCurrentWeek,
  getSeasonLeaderboard,
  getPlayerByDiscordId,
  findPlayerByName,
  getCareerLeaderboard,
  getPlayerEhogRating,
} from './queries';
import { extractSeasonNumber, matchTitle, isPlayedScore } from './util';
import { type DiscordInteraction, optionValue, callerDiscordId, messageResponse } from './discordInteractions';
import type { Player } from './types';
import { SITE_URL } from './seo/site';

const MAX_LEADERBOARD_ROWS = 25;

export async function handleLeaderboardCommand(interaction: DiscordInteraction) {
  const seasonNumber = optionValue(interaction, 'season');

  const season = seasonNumber != null
    ? (await getSeasons()).find((s) => !s.is_gauntlet && extractSeasonNumber(s.name) === Number(seasonNumber)) ?? null
    : await getActiveRegularSeason();

  if (!season) {
    return messageResponse(
      seasonNumber != null ? `No regular season ${seasonNumber} found.` : 'No season is currently active.',
    );
  }

  const seasonUrl = `${SITE_URL}/seasons/${season.id}`;
  const rows = await getSeasonLeaderboard(season.id);
  if (rows.length === 0) return messageResponse(`**${season.name}** — no games played yet.\n${seasonUrl}`);

  const shown = rows.slice(0, MAX_LEADERBOARD_ROWS);
  const lines = shown.map((r, i) => {
    const rank = `${i + 1}.`.padEnd(3);
    const record = `${r.matches_won}-${r.matches_lost}`;
    const wr = `${r.win_rate_percentage.toFixed(1)}%`;
    return `${rank} ${r.player_name.padEnd(16)} ${record.padEnd(6)} ${wr.padStart(6)}  ${r.overall_adr.toFixed(1)} ADR`;
  });
  const more = rows.length > MAX_LEADERBOARD_ROWS ? `\n… and ${rows.length - MAX_LEADERBOARD_ROWS} more` : '';

  return messageResponse(`**${season.name}**\n\`\`\`\n${lines.join('\n')}${more}\n\`\`\`\n${seasonUrl}`);
}

export async function handleScheduledCommand() {
  const season = await getActiveRegularSeason();
  if (!season) return messageResponse('No season is currently active.');

  const schedule = await getSeasonSchedule(season.id);
  const week = findCurrentWeek(schedule, season.start_date);
  if (!week || week.matches.length === 0) {
    return messageResponse(`**${season.name}** has no scheduled matches right now.\n${SITE_URL}/seasons/${season.id}`);
  }

  const lines = [...week.matches]
    .sort((a, b) => a.match_number - b.match_number)
    .map((m) => {
      const title = matchTitle({
        seasonName: season.name,
        weekNumber: week.week_number,
        matchNumber: m.match_number,
        isGauntlet: season.is_gauntlet,
      });
      const shirts = m.shirts.map((p) => p.player_name).join(' & ') || 'TBD';
      const skins = m.skins.map((p) => p.player_name).join(' & ') || 'TBD';
      const status = isPlayedScore(m.final_score)
        ? `Final: ${m.final_score}`
        : m.scheduled_at
          ? new Date(m.scheduled_at).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
          : 'Not yet scheduled';
      return `**[${title}](${SITE_URL}/matches/${m.id})**\n${shirts} vs ${skins} — ${status}`;
    });

  return messageResponse(lines.join('\n\n'));
}

export async function handlePlayerCommand(interaction: DiscordInteraction) {
  const name = optionValue(interaction, 'name');

  let player: Player | null;
  if (name != null) {
    player = await findPlayerByName(String(name));
  } else {
    const discordId = callerDiscordId(interaction);
    player = discordId ? await getPlayerByDiscordId(discordId) : null;
  }

  if (!player) {
    return messageResponse(
      name != null
        ? `No player named "${name}" found.`
        : "You're not linked to a DGLS player yet — link your Discord account on your profile, or pass a name.",
    );
  }

  const playerUrl = `${SITE_URL}/players/${player.id}`;
  const [careerRows, ehog] = await Promise.all([
    getCareerLeaderboard(),
    getPlayerEhogRating(player.id),
  ]);
  const career = careerRows.find((r) => r.player_id === player.id);

  if (!career || career.matches_played === 0) {
    return messageResponse(`**${player.name}** hasn't played a match yet.\n${playerUrl}`);
  }

  const lines = [
    `**${player.name}**`,
    `Career: ${career.matches_won}-${career.matches_lost} (${career.win_rate_percentage.toFixed(1)}% WR)`,
    `ADR: ${career.overall_adr.toFixed(1)} · RWR: ${career.rwr_percentage.toFixed(1)}%`,
  ];
  if (ehog.currentRating != null) lines.push(`EHOG: ${ehog.currentRating.toFixed(1)}`);
  lines.push(playerUrl);

  return messageResponse(lines.join('\n'));
}
