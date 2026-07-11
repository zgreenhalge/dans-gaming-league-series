import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
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
