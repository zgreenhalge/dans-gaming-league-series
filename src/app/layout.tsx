import type { Metadata } from "next";
import localFont from "next/font/local";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import AuthProvider from "@/components/AuthProvider";
import { SideNav } from "@/components/SideNav";
import { NavProvider } from "@/components/NavContext";
import { MapProvider } from "@/components/MapContext";
import { LiveMatchTicker, TICKER_HEIGHT_PX } from "@/components/LiveMatchTicker";
import { getSeasons, getMapLookup, getLiveTickerMatch } from "@/lib/queries";
import { SITE_URL } from "@/lib/seo/site";
import Script from "next/script";
import "./globals.css";

export const revalidate = 60;

// Self-hosted (src/fonts/, SIL OFL) so builds and the dev server make no request to Google.
const display = localFont({
  src: [
    { path: "../fonts/BaiJamjuree-500.woff2", weight: "500", style: "normal" },
    { path: "../fonts/BaiJamjuree-600.woff2", weight: "600", style: "normal" },
    { path: "../fonts/BaiJamjuree-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-display",
  display: "swap",
});

const sans = localFont({
  src: "../fonts/Geist-Variable.woff2",
  weight: "100 900",
  variable: "--font-sans",
  display: "swap",
});

const mono = localFont({
  src: "../fonts/JetBrainsMono-Variable.woff2",
  weight: "100 800",
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    template: "DGLS · %s",
    default: "DGLS · Dan's Gaming League Series",
  },
  description: "Stats, standings, and match history for Dan's Gaming League Series — a CS2 Wingman league.",
  openGraph: {
    title: "DGLS · Dan's Gaming League Series",
    description: "Stats, standings, and match history for Dan's Gaming League Series — a CS2 Wingman league.",
    type: "website",
    siteName: "DGLS",
    images: [{ url: '/icon.png', width: 512, height: 512, alt: 'DGLS' }],
  },
  twitter: {
    card: 'summary',
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [seasons, mapLookup, liveTicker] = await Promise.all([
    getSeasons().catch(() => []),
    getMapLookup().catch(() => ({})),
    getLiveTickerMatch().catch(() => null),
  ]);

  return (
    <html
      lang="en"
      className={`h-full antialiased ${display.variable} ${sans.variable} ${mono.variable}`}
      style={{ ['--ticker-h' as string]: liveTicker ? `${TICKER_HEIGHT_PX}px` : '0px' } as React.CSSProperties}
      suppressHydrationWarning
    >
      <body className="min-h-full dgls-atmosphere">
        <Script
          id="theme-initializer"
          src="/theme-script.js"
          strategy="beforeInteractive"
        />
        <AuthProvider>
          <MapProvider maps={mapLookup}>
          <NavProvider>
            <LiveMatchTicker initial={liveTicker} />
            <div className="flex min-h-screen" style={{ paddingTop: 'var(--content-top)' }}>
              <SideNav seasons={seasons.map((s) => ({ id: s.id, name: s.name }))} />
              <div className="flex-1 min-w-0">
                {children}
              </div>
            </div>
          </NavProvider>
          </MapProvider>
          <Analytics />
          <SpeedInsights />
        </AuthProvider>
      </body>
    </html>
  );
}
