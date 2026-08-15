import { NextResponse } from 'next/server';
import {
  verifyDiscordSignature,
  pongResponse,
  messageResponse,
  INTERACTION_TYPE_PING,
  INTERACTION_TYPE_APPLICATION_COMMAND,
  type DiscordInteraction,
} from '@/lib/discordInteractions';
import {
  handleLeaderboardCommand,
  handleScheduledCommand,
  handlePlayerCommand,
  handleNameColorCommand,
} from '@/lib/discord-commands';

// Discord Interactions HTTP endpoint (#396) — serverless slash commands, no gateway bot process.
// Discord POSTs every interaction here (after verifying this URL responds correctly to its PING
// handshake at setup time) and expects a response within 3 seconds; every command handler below is
// a handful of Supabase reads, well within that budget.
//
// Signature verification MUST run against the exact raw request bytes (`await request.text()`),
// not a re-serialized `JSON.stringify()` of the parsed body — Discord's docs require this and
// reject requests that don't verify with a 401, which is also how Discord's own setup-time
// endpoint check confirms this route is live.

export async function POST(request: Request) {
  const signature = request.headers.get('x-signature-ed25519');
  const timestamp = request.headers.get('x-signature-timestamp');
  const rawBody = await request.text();

  const publicKey = process.env.DISCORD_PUBLIC_KEY;
  if (!publicKey || !signature || !timestamp || !verifyDiscordSignature(publicKey, signature, timestamp, rawBody)) {
    return new NextResponse('invalid request signature', { status: 401 });
  }

  const interaction = JSON.parse(rawBody) as DiscordInteraction;

  if (interaction.type === INTERACTION_TYPE_PING) {
    return NextResponse.json(pongResponse());
  }

  if (interaction.type === INTERACTION_TYPE_APPLICATION_COMMAND) {
    const name = interaction.data?.name;
    try {
      switch (name) {
        case 'leaderboard':
          return NextResponse.json(await handleLeaderboardCommand(interaction));
        case 'scheduled':
          return NextResponse.json(await handleScheduledCommand());
        case 'player':
          return NextResponse.json(await handlePlayerCommand(interaction));
        case 'name-color':
          return NextResponse.json(await handleNameColorCommand(interaction));
        default:
          return NextResponse.json(messageResponse(`Unknown command: ${name}`));
      }
    } catch (e) {
      console.error(`[discord/interactions] /${name} failed:`, e);
      return NextResponse.json(messageResponse('Something went wrong running that command.'));
    }
  }

  return new NextResponse('unsupported interaction type', { status: 400 });
}
