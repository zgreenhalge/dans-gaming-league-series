// Best-effort Discord forum-thread automation for weekly matches (#398) and gauntlet pods. One
// thread per match in a regular season's `season-{N}` forum channel (`extractSeasonNumber()`'s
// convention), opening post tagging the four rostered players — `publishWeekThreads()`. A gauntlet
// pod's two games share the same 4 players and are always played sequentially, so they get one
// thread between them instead ("GAUNTLET: Round N Group M") — `publishPodThreads()`, resolving to the same
// `season-{N}` channel as the pod's paired regular season. Mentioning a player in the message a
// thread is *created* with pings them but doesn't reliably add them as a thread member, so every
// Discord-linked participant is also explicitly added as a member once the thread exists
// (`addThreadMembers()`) rather than left to that side effect. Always admin-triggered — a season's
// `start_date` is often arbitrary and so is when an admin actually wants a week/round published, so
// there's no automatic Sunday-midnight cron here, only these two functions called from
// `POST /api/seasons/[id]/discord-threads`. Every match's (or pod's) outcome is both recorded to
// `ops_errors` (`discord_thread_create`, entity `match`) and returned directly to the caller, since a
// channel permission overwrite is the likeliest first-attempt failure and needs to be visible
// immediately in the admin console, not only in the Activity feed on a later page load.
// `closeMatchThread()`/`closeGauntletPodThreadIfDone()` are the other half — archive + lock a
// thread once it has nothing left to coordinate, called from `writeMatchScore()`'s (`matchScore.ts`)
// best-effort hooks on every score write (same spot `notifyMatchScoreReported()` fires from), not
// from either publish function.
//
// Idempotency prefers a match's own previously-recorded `match_discord_state.thread_id`
// (`getKnownThreadIds()`/`resolveExistingThreadId()`) — checked against Discord itself, not just
// trusted outright, since the DB alone can't be relied on: an admin can create a thread by hand, or a
// previous run's Discord call could have succeeded right before its own DB write failed, and the DB
// would have no record of it either way. Falling back to an exact title match (`threadTitle()`'s
// "Week N Game M", or `podThreadTitle()`'s "GAUNTLET: Round N Group M") against `listChannelThreads()`'s
// read of the forum channel's actual threads is what finds a hand-made thread with no row at all; the
// id-first check is what lets an already-known thread survive its own title changing (e.g. a wording
// update) without losing idempotency. Either way, a thread that already exists is never posted into or
// otherwise touched — its thread id is just adopted into `match_discord_state` (both games' rows, for
// a pod) so the close functions can still find it once played.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSeason, getSeasonSchedule, findNextUnplayedWeek, getGauntletRounds, getGauntletPodForMatch, getPlayersById, groupPodMatches, podGamePairs } from './queries';
import type { WeekWithMatches, MatchWithRoster } from './queries/schedule';
import type { GauntletMatch, GauntletRound } from './queries/gauntlet';
import type { Season } from './types';
import { extractSeasonNumber, allMatchesPlayed } from './util';
import { recordOpsError, clearOpsError } from './ops-errors';
import { SITE_URL } from './seo/site';

const CHANNEL_OPERATION = 'discord_thread_publish';
const THREAD_OPERATION = 'discord_thread_create';
const THREAD_MEMBER_ADD_OPERATION = 'discord_thread_member_add';
const THREAD_CLOSE_OPERATION = 'discord_thread_close';
const DISCORD_FORUM_CHANNEL_TYPE = 15;

export interface ThreadPublishResult {
  matchId: number;
  title: string;
  status: 'created' | 'skipped' | 'failed';
  detail: string;
}

export interface PublishWeekThreadsResult {
  seasonName: string;
  weekNumber: number;
  matches: ThreadPublishResult[];
}

interface DiscordChannel {
  id: string;
  name: string;
  type: number;
}

/** Formats a non-ok Discord response as `"{prefix} returned {status}: {message}"` — the one shared
 *  shape every Discord call in this file uses to describe a failure, both for an `ops_errors` message
 *  and a result's own `detail`; also used by `discord-notify.ts`. */
export async function discordErrorDetail(prefix: string, res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { message?: string } | null;
  return `${prefix} returned ${res.status}${body?.message ? `: ${body.message}` : ''}`;
}

/** Resolves a season's forum channel by its `season-{N}` name — Discord's thread-creation endpoint
 *  needs a channel id, not a name, and there's no lookup-by-name API. Distinguishes "no such channel"
 *  from "wrong channel type" in its error, since a misnamed or non-forum channel is a plausible
 *  first-attempt setup mistake distinct from a permissions problem. Also the entry point
 *  `discord-event-sync.ts` uses to find a season's threads in the first place. */
export async function resolveSeasonForumChannel(
  guildId: string,
  token: string,
  seasonName: string,
): Promise<{ channelId: string } | { error: string }> {
  const seasonNumber = extractSeasonNumber(seasonName);
  if (seasonNumber === null) return { error: `Could not extract a season number from "${seasonName}"` };
  const expectedName = `season-${seasonNumber}`;

  let res: Response;
  try {
    res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
      headers: { Authorization: `Bot ${token}` },
    });
  } catch (e) {
    return { error: `Listing guild channels failed: ${(e as Error).message}` };
  }
  if (!res.ok) {
    return { error: await discordErrorDetail('Listing guild channels', res) };
  }
  const channels = (await res.json()) as DiscordChannel[];
  const channel = channels.find((c) => c.name === expectedName);
  if (!channel) return { error: `No channel named "${expectedName}" found in the guild — check the forum channel exists and the bot can see it` };
  if (channel.type !== DISCORD_FORUM_CHANNEL_TYPE) {
    return { error: `"${expectedName}" is not a forum channel (type ${channel.type})` };
  }
  return { channelId: channel.id };
}

/** A match's Discord thread title, "Week N Game M" — also how `discord-event-sync.ts` finds a
 *  match's thread in the first place (via `listChannelThreads()`'s title match), independently of
 *  `match_discord_state`. */
export function threadTitle(weekNumber: number, matchNumber: number): string {
  return `Week ${weekNumber} Game ${matchNumber}`;
}

/** A gauntlet pod's Discord thread title, "GAUNTLET: Round N Group M" (1-based, `podIndex` is
 *  0-based) — one thread per pod, not per game, since both of a pod's games share the same 4
 *  players and are scheduled/played as a unit. Same idempotency role `threadTitle()` plays for
 *  weekly threads. */
export function podThreadTitle(roundNumber: number, podIndex: number): string {
  return `GAUNTLET: Round ${roundNumber} Group ${podIndex + 1}`;
}

export interface DiscordThread {
  id: string;
  name: string;
  parent_id?: string | null;
}

/** Every thread Discord currently has in this forum channel — active, plus the first page (100, the
 *  API max) of publicly archived ones, which comfortably covers a single season's worth of weekly
 *  threads. The active-threads endpoint is guild-wide (Discord has no per-channel version), hence the
 *  `parent_id` filter; the archived one is already channel-scoped. Read once per `publishWeekThreads()`
 *  call and matched by title against every match in the target week, rather than trusting
 *  `match_discord_state` — see this file's header. `discord-event-sync.ts` reuses this same
 *  title-matched lookup to find each match's thread id before scanning it for a shared event. */
export async function listChannelThreads(
  guildId: string,
  channelId: string,
  token: string,
): Promise<DiscordThread[] | { error: string }> {
  const headers = { Authorization: `Bot ${token}` };
  let activeRes: Response;
  let archivedRes: Response;
  try {
    [activeRes, archivedRes] = await Promise.all([
      fetch(`https://discord.com/api/v10/guilds/${guildId}/threads/active`, { headers }),
      fetch(`https://discord.com/api/v10/channels/${channelId}/threads/archived/public?limit=100`, { headers }),
    ]);
  } catch (e) {
    return { error: `Listing existing threads failed: ${(e as Error).message}` };
  }
  if (!activeRes.ok) return { error: await discordErrorDetail('Listing active threads', activeRes) };
  if (!archivedRes.ok) return { error: await discordErrorDetail('Listing archived threads', archivedRes) };

  const active = (await activeRes.json()) as { threads: DiscordThread[] };
  const archived = (await archivedRes.json()) as { threads: DiscordThread[] };
  return [...active.threads.filter((t) => t.parent_id === channelId), ...archived.threads];
}

/** A player's opening-post mention: their personal Discord name-color role tag (`<@&roleId>`) when
 *  they have one, else their plain DGLS name — the same "tag if linked, else plain name" convention
 *  `discord-notify.ts`'s `playerTag()` uses for match-score announcements (kept as a separate,
 *  parallel implementation rather than a shared import: `discord-notify.ts` already imports from this
 *  file for `discordErrorDetail()`, so the reverse import would cycle). A role mention pings the one
 *  player it's assigned to, same as tagging them directly, but renders in their name-color and
 *  survives them changing their own Discord display name. Shared by a weekly match's and a gauntlet
 *  pod's opening posts alike. Only usable in a thread's plain message `content` (which `publishThread()`
 *  posts into, never an embed) — Discord doesn't parse mentions inside an embed as tags. */
function mentionOrName(p: { player_id: number; player_name: string }, playersById: Map<number, { discord_name_role_id: string | null }>): string {
  const roleId = playersById.get(p.player_id)?.discord_name_role_id;
  return roleId ? `<@&${roleId}>` : p.player_name;
}

/** The distinct linked Discord ids among `players` — every rostered participant who should end up an
 *  actual member of their match's thread (see `addThreadMembers()`), not just pinged in its opening
 *  post. A player with no `discord_id` (unlinked) is silently excluded, same as `mentionOrName()`'s
 *  plain-name fallback for them. */
function participantDiscordIds(
  players: { player_id: number }[],
  playersById: Map<number, { discord_id: string | null }>,
): string[] {
  const ids = new Set<string>();
  for (const p of players) {
    const discordId = playersById.get(p.player_id)?.discord_id;
    if (discordId) ids.add(discordId);
  }
  return [...ids];
}

/** One game's "A & B vs C & D" lineup line, mentioning each player per `mentionOrName()`. */
function lineup(
  shirts: { player_id: number; player_name: string }[],
  skins: { player_id: number; player_name: string }[],
  playersById: Map<number, { discord_name_role_id: string | null }>,
): string {
  return `${shirts.map((p) => mentionOrName(p, playersById)).join(' & ')} vs ${skins.map((p) => mentionOrName(p, playersById)).join(' & ')}`;
}

/** One match's opening-post body — the lineup line plus a link to the match's page on the site, so
 *  the thread doubles as a jumping-off point to its box score once played. */
function openingPost(match: MatchWithRoster, playersById: Map<number, { discord_name_role_id: string | null }>): string {
  return `${lineup(match.shirts, match.skins, playersById)}\n${SITE_URL}/matches/${match.id}`;
}

/** Explicitly adds each of `discordIds` as a member of a just-created thread. Mentioning someone in
 *  the `message` a forum thread is created *with* pings them but — unlike a mention posted into a
 *  thread that already exists — doesn't reliably add them to the thread's member list, so this is
 *  what actually gets a match's rostered (and Discord-linked) players into the thread's participant
 *  list, rather than relying on that starter-message side effect. Best-effort and per-user: one
 *  failure doesn't stop the rest, and none of them fail the publish itself (the thread was already
 *  created successfully by the time this runs) — recorded to `ops_errors` instead so a failure is
 *  still visible rather than silently dropped. */
async function addThreadMembers(
  supabaseAdmin: SupabaseClient,
  threadId: string,
  discordIds: string[],
  token: string,
  anchorMatchId: number,
): Promise<void> {
  if (discordIds.length === 0) return;
  // A handful of independent PUTs (one per rostered player) — run concurrently rather than
  // sequentially, unlike thread *creation* itself, which is deliberately serialized elsewhere in this
  // file out of caution around Discord's per-route rate limit on that specific endpoint.
  const outcomes = await Promise.all(
    discordIds.map(async (discordId) => {
      try {
        const res = await fetch(`https://discord.com/api/v10/channels/${threadId}/thread-members/${discordId}`, {
          method: 'PUT',
          headers: { Authorization: `Bot ${token}` },
        });
        return res.ok ? null : await discordErrorDetail(`Add thread member ${discordId}`, res);
      } catch (e) {
        return `Add thread member ${discordId} failed: ${(e as Error).message}`;
      }
    }),
  );
  const failures = outcomes.filter((f): f is string => f !== null);
  if (failures.length > 0) {
    await recordOpsError(supabaseAdmin, 'match', anchorMatchId, THREAD_MEMBER_ADD_OPERATION, failures.join('; '));
  } else {
    await clearOpsError(supabaseAdmin, 'match', anchorMatchId, THREAD_MEMBER_ADD_OPERATION);
  }
}

/** Creates (or adopts, per this file's header) a Discord thread and points every match in
 *  `matchIds` at it via `match_discord_state` — shared mechanics behind a weekly match's own thread
 *  (`matchIds` of length 1, via `publishWeekThreads()`) and a gauntlet pod's shared thread (length 2,
 *  via `publishPodThreads()`). `matchIds[0]` is the "anchor" `ops_errors`/result key either way.
 *  `participantDiscordIds` are explicitly added as thread members (`addThreadMembers()`) once a new
 *  thread is actually created — not on the adopt path, since an existing thread's membership isn't
 *  this call's to fix. */
async function publishThread(
  supabaseAdmin: SupabaseClient,
  channelId: string,
  token: string,
  title: string,
  content: string,
  matchIds: number[],
  existingThreadId: string | undefined,
  participantDiscordIds: string[],
): Promise<ThreadPublishResult> {
  const anchorId = matchIds[0];
  const stateRows = (threadId: string) => matchIds.map((matchId) => ({ match_id: matchId, thread_id: threadId }));

  if (existingThreadId) {
    await supabaseAdmin.from('match_discord_state').upsert(stateRows(existingThreadId), { onConflict: 'match_id' });
    // Deliberately doesn't claim the live thread is named `title` — it might have been adopted via a
    // previously-recorded thread_id (resolveExistingThreadId()) rather than an exact title match, in
    // which case its actual Discord name could be anything.
    await recordOpsError(
      supabaseAdmin, 'match', anchorId, THREAD_OPERATION,
      `Already linked to thread ${existingThreadId} — adopted it instead of creating a duplicate for "${title}"`,
    );
    return { matchId: anchorId, title, status: 'skipped', detail: `Already exists (thread ${existingThreadId})` };
  }

  try {
    const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/threads`, {
      method: 'POST',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: title, message: { content } }),
    });
    if (!res.ok) {
      const detail = await discordErrorDetail('Thread create', res);
      await recordOpsError(supabaseAdmin, 'match', anchorId, THREAD_OPERATION, detail);
      return { matchId: anchorId, title, status: 'failed', detail };
    }
    const thread = (await res.json()) as { id: string };
    await supabaseAdmin.from('match_discord_state').upsert(stateRows(thread.id), { onConflict: 'match_id' });
    await clearOpsError(supabaseAdmin, 'match', anchorId, THREAD_OPERATION);
    await addThreadMembers(supabaseAdmin, thread.id, participantDiscordIds, token, anchorId);
    return { matchId: anchorId, title, status: 'created', detail: `Thread ${thread.id}` };
  } catch (e) {
    const detail = `Thread create failed: ${(e as Error).message}`;
    await recordOpsError(supabaseAdmin, 'match', anchorId, THREAD_OPERATION, detail);
    return { matchId: anchorId, title, status: 'failed', detail };
  }
}

/** Resolves a season's forum channel and its already-existing threads — the season-level scaffold
 *  shared by `publishWeekThreads()` and `publishPodThreads()`. Records/clears the
 *  `discord_thread_publish` ops error itself. */
async function resolveChannelAndThreads(
  supabaseAdmin: SupabaseClient,
  seasonId: number,
  seasonName: string,
  guildId: string,
  token: string,
): Promise<{ channelId: string; existingByTitle: Map<string, string> } | { error: string }> {
  const channel = await resolveSeasonForumChannel(guildId, token, seasonName);
  if ('error' in channel) {
    await recordOpsError(supabaseAdmin, 'season', seasonId, CHANNEL_OPERATION, channel.error);
    return { error: channel.error };
  }
  const existingThreads = await listChannelThreads(guildId, channel.channelId, token);
  if ('error' in existingThreads) {
    await recordOpsError(supabaseAdmin, 'season', seasonId, CHANNEL_OPERATION, existingThreads.error);
    return { error: existingThreads.error };
  }
  await clearOpsError(supabaseAdmin, 'season', seasonId, CHANNEL_OPERATION);
  return { channelId: channel.channelId, existingByTitle: new Map(existingThreads.map((t) => [t.name, t.id])) };
}

function resolveTargetWeek(schedule: WeekWithMatches[], week: number | 'next'): WeekWithMatches | null {
  return week === 'next' ? findNextUnplayedWeek(schedule) : schedule.find((w) => w.week_number === week) ?? null;
}

/** Every one of `matchIds`' already-known thread id, from a prior publish — read once per publish
 *  call rather than trusted as the *only* way to find a thread (see this file's header on why title
 *  matching against Discord itself is still the fallback: a hand-made thread, or a previous run whose
 *  Discord call succeeded right before its own DB write failed, has no row here at all).
 *  `discord-event-sync.ts` doesn't call this directly — its own `match_discord_state` read also needs
 *  `event_id`/`message_checkpoint`, so it derives the same id map from its own richer query instead;
 *  `resolveExistingThreadId()` below is what the two files actually share. A read failure here
 *  degrades to exactly the title-only matching that existed before this lookup was added, rather than
 *  failing the whole publish — this is a resilience improvement layered on an already-correct
 *  fallback, not something publishing depends on. */
async function getKnownThreadIds(supabaseAdmin: SupabaseClient, matchIds: number[]): Promise<Map<number, string>> {
  if (matchIds.length === 0) return new Map();
  const { data, error } = await supabaseAdmin.from('match_discord_state').select('match_id, thread_id').in('match_id', matchIds);
  const known = new Map<number, string>();
  if (error) return known;
  for (const row of (data ?? []) as { match_id: number; thread_id: string | null }[]) {
    if (row.thread_id) known.set(row.match_id, row.thread_id);
  }
  return known;
}

/** The thread a match (or a pod's two matches) should be adopted into, if one already exists —
 *  preferring a previously-recorded `match_discord_state.thread_id` (so a thread survives its own
 *  title changing, e.g. a wording update to `threadTitle()`/`podThreadTitle()`) over the exact-title
 *  match `existingByTitle` still falls back to for a thread this code has never recorded a row for. A
 *  recorded id is only trusted once confirmed still live (present in `liveThreadIds`, sourced from the
 *  same `listChannelThreads()` read `existingByTitle` came from) — a stale id (the thread was deleted,
 *  or moved) falls through to the title match exactly as if no row existed. Exported so
 *  `discord-event-sync.ts` shares this exact resolution rather than a second, hand-rolled copy. */
export function resolveExistingThreadId(
  matchIds: number[],
  knownThreadIdByMatch: Map<number, string>,
  liveThreadIds: Set<string>,
  existingByTitle: Map<string, string>,
  title: string,
): string | undefined {
  for (const matchId of matchIds) {
    const known = knownThreadIdByMatch.get(matchId);
    if (known && liveThreadIds.has(known)) return known;
  }
  return existingByTitle.get(title);
}

/** Archives + locks a single match's Discord thread, if it has one — `writeMatchScore()`'s
 *  (`matchScore.ts`) best-effort hook, called unconditionally on every score write, including an
 *  admin's later correction. No-ops without `DISCORD_BOT_TOKEN` or without a recorded
 *  `match_discord_state.thread_id` — most matches were never threaded in the first place.
 *  Archiving/locking an already-archived thread is a harmless no-op on Discord's side, so a retry (or
 *  a repeat call on a match that's already closed) can't double-fail — there's no need to gate this
 *  on a first-time score. Never throws: the `match_discord_state` read and the Discord call share one
 *  try/catch, recording a real failure to `ops_errors` rather than letting it propagate into
 *  `writeMatchScore()`'s `Promise.all`. */
export async function closeMatchThread(supabaseAdmin: SupabaseClient, matchId: number): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return;

  try {
    const { data } = await supabaseAdmin
      .from('match_discord_state')
      .select('thread_id')
      .eq('match_id', matchId)
      .maybeSingle();
    const threadId = (data as { thread_id: string | null } | null)?.thread_id ?? null;
    if (!threadId) return;

    const res = await fetch(`https://discord.com/api/v10/channels/${threadId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: true, locked: true }),
    });
    if (!res.ok) {
      const detail = await discordErrorDetail('Thread close', res);
      await recordOpsError(supabaseAdmin, 'match', matchId, THREAD_CLOSE_OPERATION, detail);
      return;
    }
    await clearOpsError(supabaseAdmin, 'match', matchId, THREAD_CLOSE_OPERATION);
  } catch (e) {
    await recordOpsError(supabaseAdmin, 'match', matchId, THREAD_CLOSE_OPERATION, `Thread close failed: ${(e as Error).message}`);
  }
}

/** Publishes one week's match threads for a regular season. `week` is either an explicit week number
 *  or `'next'`, resolved via `findNextUnplayedWeek()` — the first week with no played matches yet,
 *  not the calendar-current week `findCurrentWeek()` gives the home page and `/scheduled` — since
 *  out-of-order match entry means those can disagree on which week still needs threads. Threads are
 *  created one at a time rather than in parallel, out of caution around
 *  Discord's per-route rate limits on forum thread creation. Returns `{ error }` for a season-level
 *  failure (bad season, unconfigured Discord, channel not found/wrong type, no such week) before any
 *  match is attempted; otherwise every match's own outcome, whether or not some of them failed.
 *  `knownSeason`, if given, skips the `getSeason()` lookup — for a caller (the publish route) that
 *  already fetched the season to decide which of this/`publishPodThreads` to call. */
export async function publishWeekThreads(
  supabaseAdmin: SupabaseClient,
  seasonId: number,
  week: number | 'next',
  knownSeason?: Season,
): Promise<PublishWeekThreadsResult | { error: string }> {
  const season = knownSeason ?? (await getSeason(seasonId));
  if (!season) return { error: 'Season not found' };
  if (season.is_gauntlet) return { error: 'Gauntlet seasons do not use weekly match threads' };

  const token = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!token || !guildId) return { error: 'Discord is not configured (DISCORD_BOT_TOKEN / DISCORD_GUILD_ID)' };

  const schedule = await getSeasonSchedule(seasonId);
  const targetWeek = resolveTargetWeek(schedule, week);
  if (!targetWeek) return { error: week === 'next' ? 'No upcoming week found' : `Week ${week} not found` };
  if (targetWeek.matches.length === 0) return { error: `Week ${targetWeek.week_number} has no matches` };

  // Independent reads — the Discord channel/thread lookup, the already-known thread ids, and the
  // roster — run concurrently rather than as one long sequential chain.
  const [resolved, knownThreadIdByMatch, playersById] = await Promise.all([
    resolveChannelAndThreads(supabaseAdmin, seasonId, season.name, guildId, token),
    getKnownThreadIds(supabaseAdmin, targetWeek.matches.map((m) => m.id)),
    getPlayersById(),
  ]);
  if ('error' in resolved) return resolved;
  const { channelId, existingByTitle } = resolved;
  const liveThreadIds = new Set(existingByTitle.values());

  const results: ThreadPublishResult[] = [];
  for (const match of targetWeek.matches) {
    const title = threadTitle(targetWeek.week_number, match.match_number);
    const existingThreadId = resolveExistingThreadId([match.id], knownThreadIdByMatch, liveThreadIds, existingByTitle, title);
    const discordIds = participantDiscordIds([...match.shirts, ...match.skins], playersById);
    results.push(
      await publishThread(supabaseAdmin, channelId, token, title, openingPost(match, playersById), [match.id], existingThreadId, discordIds),
    );
  }

  return { seasonName: season.name, weekNumber: targetWeek.week_number, matches: results };
}

/** A pod's opening post: both games' shirts-vs-skins lineups, each linked to its own match page.
 *  Both games share the same 4 players reshuffled across factions, so this is the one place a pod
 *  thread actually distinguishes them — and they're separate matches, so each gets its own link
 *  rather than one link for the pod. */
function podOpeningPost(game1: GauntletMatch, game2: GauntletMatch, playersById: Map<number, { discord_name_role_id: string | null }>): string {
  return `Game 1: ${lineup(game1.shirts_stats, game1.skins_stats, playersById)} — ${SITE_URL}/matches/${game1.id}\n` +
    `Game 2: ${lineup(game2.shirts_stats, game2.skins_stats, playersById)} — ${SITE_URL}/matches/${game2.id}`;
}

export interface PublishPodThreadsResult {
  seasonName: string;
  /** The single round targeted, or `null` when `round: 'next'` swept every round for newly-finalized
   *  pods rather than targeting one round in particular (see `publishPodThreads()`'s doc comment). */
  roundNumber: number | null;
  pods: ThreadPublishResult[];
}

/** Publishes pod threads for a gauntlet season — the pod counterpart to `publishWeekThreads()`,
 *  resolving to the same `season-{N}` forum channel as the paired regular season
 *  (`extractSeasonNumber()` parses "Season N Gauntlet" the same as "Season N"). An explicit `round`
 *  number targets that one round, reporting every pod in it — one whose two games aren't both
 *  materialized yet is `failed` rather than attempted, since there's nothing to link to until it is.
 *
 *  `round: 'next'` means something different here than it does for `publishWeekThreads()`'s weeks: a
 *  bracket's parallel groups within the *same* round resolve independently, so one pod can finalize
 *  (both games materialize) well before its round-mate does — there's no single "next round" to point
 *  at the way there's a single next week. So `'next'` instead sweeps every round for every
 *  fully-materialized pod that doesn't have a thread yet (checked against Discord itself, per this
 *  file's header comment) and publishes all of them in one call — an unmaterialized pod is silently
 *  skipped rather than reported, since there's nothing yet to say about it. `knownSeason`, if given,
 *  skips the `getSeason()` lookup — see `publishWeekThreads()`'s own doc comment. */
export async function publishPodThreads(
  supabaseAdmin: SupabaseClient,
  gauntletSeasonId: number,
  round: number | 'next',
  knownSeason?: Season,
): Promise<PublishPodThreadsResult | { error: string }> {
  const season = knownSeason ?? (await getSeason(gauntletSeasonId));
  if (!season) return { error: 'Season not found' };
  if (!season.is_gauntlet) return { error: 'Not a gauntlet season' };

  const token = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!token || !guildId) return { error: 'Discord is not configured (DISCORD_BOT_TOKEN / DISCORD_GUILD_ID)' };

  const rounds = await getGauntletRounds(gauntletSeasonId);

  // Independent reads — the Discord channel/thread lookup, the already-known thread ids, and the
  // roster — run concurrently rather than as one long sequential chain. The known-ids lookup covers
  // the whole gauntlet's materialized matches, not just the round(s) this call targets — small and
  // bounded (a bracket has few rounds), and simpler than re-deriving the same scope split as the
  // round/'next' branches below just to narrow this one lookup.
  const [resolved, knownThreadIdByMatch, playersById] = await Promise.all([
    resolveChannelAndThreads(supabaseAdmin, gauntletSeasonId, season.name, guildId, token),
    getKnownThreadIds(supabaseAdmin, rounds.flatMap((r) => r.matches.map((m) => m.id))),
    getPlayersById(),
  ]);
  if ('error' in resolved) return resolved;
  const { channelId, existingByTitle } = resolved;
  const liveThreadIds = new Set(existingByTitle.values());

  const publishPod = (title: string, game1: GauntletMatch, game2: GauntletMatch) => {
    const existingThreadId = resolveExistingThreadId([game1.id, game2.id], knownThreadIdByMatch, liveThreadIds, existingByTitle, title);
    const discordIds = participantDiscordIds(
      [...game1.shirts_stats, ...game1.skins_stats, ...game2.shirts_stats, ...game2.skins_stats],
      playersById,
    );
    return publishThread(supabaseAdmin, channelId, token, title, podOpeningPost(game1, game2, playersById), [game1.id, game2.id], existingThreadId, discordIds);
  };

  if (round === 'next') {
    // podGamePairs() already carries the "fully materialized" filter and the game1/game2 pairing —
    // an unmaterialized pod is simply absent from it, exactly the silent-skip this sweep wants.
    const results: ThreadPublishResult[] = [];
    for (const targetRound of rounds) {
      for (const { podIndex, game1, game2 } of podGamePairs(targetRound)) {
        const title = podThreadTitle(targetRound.round_number, podIndex);
        if (existingByTitle.has(title)) continue;
        results.push(await publishPod(title, game1, game2));
      }
    }
    if (results.length === 0) return { error: 'No newly finalized pods to publish' };
    return { seasonName: season.name, roundNumber: null, pods: results };
  }

  const targetRound = rounds.find((r) => r.round_number === round);
  if (!targetRound) return { error: `Round ${round} not found` };
  const byPod = groupPodMatches(targetRound);
  if (byPod.size === 0) return { error: `Round ${targetRound.round_number} has no materialized pods` };
  // Reuse podGamePairs() for the pairing itself — groupPodMatches() is still needed here (unlike the
  // 'next' sweep above) to enumerate an incomplete pod so it can be reported `failed`, which
  // podGamePairs() silently excludes.
  const pairsByPodIndex = new Map(podGamePairs(targetRound).map((p) => [p.podIndex, p]));

  const results: ThreadPublishResult[] = [];
  for (const podIndex of [...byPod.keys()].sort((a, b) => a - b)) {
    const title = podThreadTitle(targetRound.round_number, podIndex);
    const pair = pairsByPodIndex.get(podIndex);
    if (!pair) {
      results.push({ matchId: byPod.get(podIndex)![0]?.id ?? 0, title, status: 'failed', detail: 'Pod is not fully materialized (expected 2 games)' });
      continue;
    }
    results.push(await publishPod(title, pair.game1, pair.game2));
  }
  return { seasonName: season.name, roundNumber: targetRound.round_number, pods: results };
}

/** Gauntlet counterpart to `closeMatchThread()` — a pod's thread coordinates both of its games, so
 *  it must not archive/lock after only the first is scored. No-ops until both of the pod's games
 *  have a played score, then closes the shared thread via either game's `match_discord_state` row
 *  (`publishPodThreads()` points both at the same thread id). No-ops (not an error) for a match with
 *  no resolvable pod. */
export async function closeGauntletPodThreadIfDone(supabaseAdmin: SupabaseClient, matchId: number): Promise<void> {
  const pod = await getGauntletPodForMatch(matchId);
  if (!pod) return;

  const { data, error } = await supabaseAdmin
    .from('matches')
    .select('id, final_score')
    .in('id', [pod.match1_id, pod.match2_id]);
  if (error) {
    console.error(`closeGauntletPodThreadIfDone(${matchId}) failed to read pod matches:`, error);
    return;
  }
  const matches = (data ?? []) as { id: number; final_score: string | null }[];
  if (matches.length !== 2 || !allMatchesPlayed(matches)) return;

  await closeMatchThread(supabaseAdmin, matchId);
}
