// Shared plumbing for scripts/inspect-demo.ts and scripts/inspect-demo-fields.ts: the tiny
// dependency-free flag parser and the `--demo <path>` / `--match <id>` source resolution both
// scripts offer.

import { GetObjectCommand } from '@aws-sdk/client-s3';
import { r2, R2_BUCKET, demoKey } from '../src/lib/r2';

/** Parses `--flag value` and bare `--flag` (boolean) pairs off argv; unrecognized bare tokens are
 *  ignored rather than erroring, since each script only reads the flags it documents. */
export function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

export function die(msg: string): never {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

export async function loadDemoFromR2(matchId: number): Promise<Buffer> {
  const res = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: demoKey(matchId) }));
  if (!res.Body) die(`No demo in R2 at ${demoKey(matchId)}`);
  const chunks: Buffer[] = [];
  for await (const chunk of res.Body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
