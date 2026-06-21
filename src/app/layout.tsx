import type { Metadata } from "next";
import { Bai_Jamjuree, Geist, JetBrains_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import AuthProvider from "@/components/AuthProvider";
import { SideNav } from "@/components/SideNav";
import { NavProvider } from "@/components/NavContext";
import { getSeasons } from "@/lib/queries";
import Script from "next/script";
import "./globals.css";

const display = Bai_Jamjuree({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

const sans = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

const SITE_URL = 'https://dans-gaming-league-series.vercel.app';

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
  const seasons = await getSeasons().catch(() => []);

  return (
    <html
      lang="en"
      className={`h-full antialiased ${display.variable} ${sans.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-full dgls-atmosphere">
        <Script
          id="theme-initializer"
          src="/theme-script.js"
          strategy="beforeInteractive"
        />
        <AuthProvider>
          <NavProvider>
            <div className="flex min-h-screen" style={{ paddingTop: 'var(--topbar-h)' }}>
              <SideNav seasons={seasons.map((s) => ({ id: s.id, name: s.name }))} />
              <div className="flex-1 min-w-0">
                {children}
              </div>
            </div>
          </NavProvider>
          <Analytics />
          <SpeedInsights />
        </AuthProvider>
      </body>
    </html>
  );
}
