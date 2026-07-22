import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';

export const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY!,
  },
  // R2 doesn't require automatic checksums; disabling avoids CORS preflight issues
  // with the extra x-amz-checksum-* headers the SDK v3 adds by default.
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

export const R2_BUCKET = process.env.CLOUDFLARE_R2_BUCKET_NAME!;

export function demoKey(matchId: number): string {
  return `${matchId}/game.dem`;
}

/** Deterministic key for a match's 2D replay payload (gzipped JSON). */
export function replayKey(matchId: number): string {
  return `${matchId}/replay.json`;
}

/** Deterministic key for a match's compact heatmap points artifact (gzipped JSON). */
export function heatmapKey(matchId: number): string {
  return `${matchId}/heatmap.json`;
}

/** Deterministic key for a match's compact per-player trace artifact (gzipped JSON). */
export function traceKey(matchId: number): string {
  return `${matchId}/traces.json`;
}

/** Deterministic key for a map's merged heatmap rollup across every match on it (gzipped JSON). */
export function mapHeatmapKey(slug: string): string {
  return `maps/${slug}/heatmap.json`;
}

/** Deterministic key for a map's merged player-trace rollup across every match on it (gzipped JSON). */
export function mapTraceKey(slug: string): string {
  return `maps/${slug}/traces.json`;
}

/** Deterministic key for a map's extracted top-down radar PNG. */
export function radarKey(mapId: number): string {
  return `maps/${mapId}/radar.png`;
}

/** Deterministic key for a match's pending demo-ingest result (gzipped JSON). Transient — written by
 *  the demo-ingest Action, deleted on confirm/dismiss. */
export function demoResultKey(matchId: number): string {
  return `${matchId}/demo-result.json`;
}

/** Deterministic key for a match's staged MatchZy `map_result` event (gzipped JSON) — the trusted
 *  auto-commit cross-check (#138). Transient — written by `POST /api/ingest/matchzy-log`. */
export function mapResultKey(matchId: number): string {
  return `${matchId}/map-result.json`;
}

/** Deterministic key for a match's last-seen MatchZy remote-log event (gzipped JSON) — overwritten on
 *  every `POST /api/ingest/matchzy-log` hit, regardless of event type. The signal that answers "did
 *  the server ever talk to us for this match" without live RCON. */
export function matchzyContactKey(matchId: number): string {
  return `${matchId}/matchzy-contact.json`;
}

/** Download an R2 object into a Buffer, or `null` if it doesn't exist. */
export async function getR2Object(key: string): Promise<Buffer | null> {
  try {
    const res = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    if (!res.Body) return null;
    const chunks: Buffer[] = [];
    for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  } catch (err) {
    if ((err as { name?: string }).name === 'NoSuchKey') return null;
    throw err;
  }
}

/** Upload a Buffer to R2 at `key`. */
export async function putR2Object(
  key: string,
  body: Buffer,
  opts: { contentType?: string; contentEncoding?: string } = {},
): Promise<void> {
  await r2.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: opts.contentType,
      ContentEncoding: opts.contentEncoding,
    }),
  );
}

/** Delete an R2 object. No-op-safe: deleting a missing key does not throw. */
export async function deleteR2Object(key: string): Promise<void> {
  await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
}

/** HEAD a match's demo (`<id>/game.dem`) — its size, or `null` if it doesn't exist. Shared by
 *  `demoExists()` and the ingest-notify route, which also needs the byte count. A non-404 failure
 *  (auth, transient network) is rethrown rather than treated as "missing" — that distinction matters
 *  to both callers: notify reports it as a real error instead of a misleading "no demo", and
 *  `demoExists()` doesn't silently hide the manual-retry UI it's meant to expose. */
export async function headDemoObject(matchId: number): Promise<{ contentLength: number | null } | null> {
  try {
    const head = await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: demoKey(matchId) }));
    return { contentLength: head.ContentLength ?? null };
  } catch (err) {
    if ((err as { name?: string }).name === 'NotFound') return null;
    throw err;
  }
}

/** Whether a match's demo is present in R2, regardless of whether anything has ever parsed it — the
 *  signal that lets a stalled/never-dispatched ingest be manually retried without re-uploading. */
export async function demoExists(matchId: number): Promise<boolean> {
  return (await headDemoObject(matchId)) !== null;
}

/** Every match id with an uploaded demo (`<id>/game.dem`), ascending. Paginates the whole bucket. */
export async function listDemoMatchIds(): Promise<number[]> {
  const ids = new Set<number>();
  let token: string | undefined;
  do {
    const res = await r2.send(new ListObjectsV2Command({ Bucket: R2_BUCKET, ContinuationToken: token }));
    for (const obj of res.Contents ?? []) {
      const m = /^(\d+)\/game\.dem$/.exec(obj.Key ?? '');
      if (m) ids.add(Number(m[1]));
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return [...ids].sort((a, b) => a - b);
}
