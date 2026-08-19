// Dumps a Discord thread's raw message history and the guild's scheduled events side by side — the
// two inputs discord-event-sync.ts's syncSeasonScheduledEvents() correlates. Read-only (GET requests
// only); makes no writes to Discord or the DB. Useful whenever a thread's shared event isn't showing
// up as synced and the reason isn't obvious from the sync's own summary output.
//
// Usage:
//   DISCORD_BOT_TOKEN=... DISCORD_GUILD_ID=... npx tsx scripts/inspect-discord-thread.ts --thread <id>
//
// Flags:
//   --thread <id>   required. The Discord thread (channel) id to dump messages from.
//   --event <id>    optional. Highlights this event id if it appears in either the message scan or
//                   the guild's scheduled-events list, so a specific "why didn't this match" case is
//                   easy to spot in the output.

const THREAD_ID = process.argv.includes('--thread') ? process.argv[process.argv.indexOf('--thread') + 1] : undefined;
const EVENT_ID = process.argv.includes('--event') ? process.argv[process.argv.indexOf('--event') + 1] : undefined;

const token = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;

function die(msg: string): never {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

if (!THREAD_ID) die('Missing --thread <id>.');
if (!token || !guildId) die('DISCORD_BOT_TOKEN and DISCORD_GUILD_ID must be set.');

interface DiscordMessage {
  id: string;
  content: string;
  author?: { username?: string; bot?: boolean };
  embeds?: { url?: string; title?: string }[];
  type?: number;
}

interface DiscordScheduledEvent {
  id: string;
  name: string;
  status: number;
  scheduled_start_time: string;
}

const STATUS_NAME: Record<number, string> = { 1: 'SCHEDULED', 2: 'ACTIVE', 3: 'COMPLETED', 4: 'CANCELED' };

async function fetchDiscord<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bot ${token}` } });
  const body = await res.json();
  if (!res.ok) die(`GET ${url} -> ${res.status}: ${JSON.stringify(body)}`);
  return body as T;
}

async function main() {
  console.log('\n=== guild scheduled events ===');
  const events = await fetchDiscord<DiscordScheduledEvent[]>(
    `https://discord.com/api/v10/guilds/${guildId}/scheduled-events`,
  );
  if (events.length === 0) console.log('(none)');
  for (const e of events) {
    const flag = EVENT_ID && e.id === EVENT_ID ? '  <-- --event match' : '';
    console.log(`  ${e.id}  ${STATUS_NAME[e.status] ?? `status ${e.status}`}  start=${e.scheduled_start_time}  "${e.name}"${flag}`);
  }

  console.log(`\n=== thread ${THREAD_ID} messages (newest first, all pages) ===`);
  let before: string | undefined;
  let page = 0;
  let total = 0;
  for (;;) {
    page++;
    const url = `https://discord.com/api/v10/channels/${THREAD_ID}/messages?limit=100${before ? `&before=${before}` : ''}`;
    const messages = await fetchDiscord<DiscordMessage[]>(url);
    if (messages.length === 0) break;
    for (const m of messages) {
      total++;
      const author = m.author?.bot ? `${m.author.username} [bot]` : (m.author?.username ?? 'unknown');
      const eventMatch = EVENT_ID && (m.content.includes(EVENT_ID) || (m.embeds ?? []).some((e) => (e.url ?? '').includes(EVENT_ID)));
      console.log(`\n  [page ${page}] id=${m.id} type=${m.type ?? 0} author=${author}${eventMatch ? '  <-- contains --event id' : ''}`);
      console.log(`    content: ${JSON.stringify(m.content)}`);
      for (const embed of m.embeds ?? []) {
        console.log(`    embed: title=${JSON.stringify(embed.title)} url=${JSON.stringify(embed.url)}`);
      }
    }
    if (messages.length < 100) break;
    before = messages[messages.length - 1].id;
  }
  console.log(`\n${total} message(s) across ${page} page(s).`);
}

main().catch((e) => die(e instanceof Error ? e.stack ?? e.message : String(e)));
