import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const OG_SIZE = { width: 1200, height: 630 };

const BG = '#161a21';
const BG2 = '#1d222b';
const TEXT = '#e8e0cc';
const TEXT2 = '#a09882';
const BORDER = '#3a3428';
const ACCENT = '#4ea1ff';
const GREEN = '#5b9636';
const RED = '#b33a2d';
const AMBER = '#f5c542';

export const colors = { BG, BG2, TEXT, TEXT2, BORDER, ACCENT, GREEN, RED, AMBER };

const ALLOWED_IMAGE_HOSTS = ['steamuserimages-a.akamaihd.net', 'cdn.cloudflare.steamstatic.com'];

export async function loadMapImageAsDataUri(path: string): Promise<string | null> {
  try {
    if (path.startsWith('http://') || path.startsWith('https://')) {
      const url = new URL(path);
      if (!ALLOWED_IMAGE_HOSTS.includes(url.hostname)) return null;
      const res = await fetch(path, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      const ct = res.headers.get('content-type') ?? 'image/jpeg';
      return `data:${ct};base64,${buf.toString('base64')}`;
    }
    const buf = await readFile(join(process.cwd(), 'public', path));
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

let fontCache: { geist: ArrayBuffer; jetbrains: ArrayBuffer; geistBold: ArrayBuffer } | null = null;

export async function loadFonts() {
  if (fontCache) return fontCache;

  const [geist, geistBold, jetbrains] = await Promise.all([
    readFile(join(process.cwd(), 'src/assets/Geist-Regular.ttf')),
    readFile(join(process.cwd(), 'src/assets/Geist-SemiBold.ttf')),
    readFile(join(process.cwd(), 'src/assets/JetBrainsMono-Medium.ttf')),
  ]);

  fontCache = {
    geist: geist.buffer.slice(geist.byteOffset, geist.byteOffset + geist.byteLength),
    geistBold: geistBold.buffer.slice(geistBold.byteOffset, geistBold.byteOffset + geistBold.byteLength),
    jetbrains: jetbrains.buffer.slice(jetbrains.byteOffset, jetbrains.byteOffset + jetbrains.byteLength),
  };
  return fontCache;
}

export function fontConfig(fonts: Awaited<ReturnType<typeof loadFonts>>) {
  return [
    { name: 'Geist', data: fonts.geist, style: 'normal' as const, weight: 400 as const },
    { name: 'Geist', data: fonts.geistBold, style: 'normal' as const, weight: 600 as const },
    { name: 'JetBrains Mono', data: fonts.jetbrains, style: 'normal' as const, weight: 500 as const },
  ];
}

export function CardShell({ children, subtitle, bgImage }: { children: React.ReactNode; subtitle?: string; bgImage?: string }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: BG,
        fontFamily: 'Geist',
        color: TEXT,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {bgImage && (
        <img
          src={bgImage}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: 0.3,
          }}
        />
      )}
      {bgImage && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: 'linear-gradient(to top, #161a21 30%, transparent 100%)',
        }} />
      )}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '28px 40px', position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{ fontWeight: 600, fontSize: '40px', letterSpacing: '4px', color: ACCENT }}>
            DGLS
          </span>
          {subtitle && (
            <span style={{ fontSize: '34px', color: TEXT2, fontFamily: 'JetBrains Mono' }}>
              {subtitle}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

const EHOG_TIERS = [
  { min: 99, color: '#f5c542' },
  { min: 95, color: '#eb4b4b' },
  { min: 80, color: '#d32ee6' },
  { min: 60, color: '#8847ff' },
  { min: 30, color: '#4b69ff' },
  { min: 15, color: '#1ac8ed' },
  { min: 0,  color: '#b0b0b0' },
];

export function ehogColor(rating: number): string {
  return (EHOG_TIERS.find(t => rating >= t.min) ?? EHOG_TIERS[EHOG_TIERS.length - 1]).color;
}

export function StatPill({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
      <span style={{ fontFamily: 'JetBrains Mono', fontSize: '52px', fontWeight: 600, color: color ?? TEXT }}>
        {value}
      </span>
      <span style={{ fontFamily: 'JetBrains Mono', fontSize: '24px', color: TEXT2, letterSpacing: '2px', textTransform: 'uppercase' }}>
        {label}
      </span>
    </div>
  );
}
