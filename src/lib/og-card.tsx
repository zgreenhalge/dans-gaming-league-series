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

export function CardShell({ children, subtitle }: { children: React.ReactNode; subtitle?: string }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: BG,
        padding: '48px 56px',
        fontFamily: 'Geist',
        color: TEXT,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '8px' }}>
        <span style={{ fontWeight: 600, fontSize: '20px', letterSpacing: '2px', color: ACCENT }}>
          DGLS
        </span>
        {subtitle && (
          <>
            <span style={{ color: TEXT2, fontSize: '20px' }}>·</span>
            <span style={{ fontSize: '18px', color: TEXT2, fontFamily: 'JetBrains Mono' }}>
              {subtitle}
            </span>
          </>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
        {children}
      </div>
    </div>
  );
}

export function StatPill({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
      <span style={{ fontFamily: 'JetBrains Mono', fontSize: '28px', fontWeight: 600, color: color ?? TEXT }}>
        {value}
      </span>
      <span style={{ fontFamily: 'JetBrains Mono', fontSize: '12px', color: TEXT2, letterSpacing: '1px', textTransform: 'uppercase' }}>
        {label}
      </span>
    </div>
  );
}
