// Gzip helpers shared by the demo/replay pipelines. Demos and artifacts are stored either raw or
// gzipped; these centralize the magic-byte sniff so every reader agrees on the same check.

import { gunzipSync } from 'node:zlib';

/** True if `buf` starts with the gzip magic bytes (0x1f 0x8b). */
export function isGzip(buf: Buffer): boolean {
  return buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
}

/** Gunzip `buf` if it's gzipped; otherwise return it unchanged. */
export function gunzipMaybe(buf: Buffer): Buffer {
  return isGzip(buf) ? gunzipSync(buf) : buf;
}
