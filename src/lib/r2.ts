import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

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

/** Deterministic key for a map's extracted top-down radar PNG. */
export function radarKey(mapId: number): string {
  return `maps/${mapId}/radar.png`;
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
