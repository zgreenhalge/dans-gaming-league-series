// Shape + R2 read/write for a multi-segment match's demo manifest (see docs/demo-ingestion.md's
// "Multi-segment demos") — the ordered list of segment keys a multi-file demo upload wrote. Written
// by `POST /api/matches/[id]/demo/segments/finalize` only once every segment has actually finished
// uploading, and read by the parse route (to decide whether to combine segments instead of reading
// the single-file demoKey()) and the DatHost retention check (to gate residue deletion on every
// listed segment, not just the canonical single-file key, actually being present in R2).

import { gzipSync } from 'node:zlib';
import { getR2Object, putR2Object, demoManifestKey } from '../r2';
import { gunzipMaybe } from '../gzip';

export interface DemoSegmentManifest {
  segments: string[];
}

/** Persist a multi-segment match's manifest to R2, gzipped. */
export async function putDemoManifest(matchId: number, segments: string[]): Promise<void> {
  await putR2Object(
    demoManifestKey(matchId),
    gzipSync(Buffer.from(JSON.stringify({ segments } satisfies DemoSegmentManifest))),
    { contentType: 'application/json', contentEncoding: 'gzip' },
  );
}

/** Read a match's demo manifest, or null if it has none (a normal single-file upload) or its shape
 *  is unreadable. */
export async function getDemoManifest(matchId: number): Promise<DemoSegmentManifest | null> {
  const buf = await getR2Object(demoManifestKey(matchId));
  if (!buf) return null;
  try {
    const parsed = JSON.parse(gunzipMaybe(buf).toString('utf8')) as DemoSegmentManifest;
    return Array.isArray(parsed.segments) && parsed.segments.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}
