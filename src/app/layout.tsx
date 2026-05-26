import type { Metadata } from "next";
import { Bai_Jamjuree, Geist, JetBrains_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import AuthProvider from "@/components/AuthProvider";
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

export const metadata: Metadata = {
  title: {
    template: "DGLS · %s",
    default: "DGLS · Dan's Gaming League Series",
  },
  openGraph: {
    title: "DGLS · Dan's Gaming League Series",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`h-full antialiased ${display.variable} ${sans.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-full">
        {/* Next.js safely handles optimization and blocking via your public file asset */}
        <Script
          id="theme-initializer"
          src="/theme-script.js"
          strategy="beforeInteractive"
        />
        <AuthProvider>
            {children}
            <Analytics />
            <SpeedInsights />
        </AuthProvider>
      </body>
    </html>
  );
}