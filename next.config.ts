import type { NextConfig } from "next";

// Every retained Vercel deployment stores one bundle per server route, so anything
// traced into a route counts against Function Storage once per route per
// deployment. See docs/vercel.md before adding a dependency with native binaries.
const nextConfig: NextConfig = {
  serverExternalPackages: ['@laihoe/demoparser2'],
  outputFileTracingExcludes: {
    '*': [
      // next/og only *tries* `import("sharp")` and falls back to resvg-wasm, and
      // image optimization on Vercel never runs sharp in our functions. Traced,
      // it adds ~34 MB of libvips to every OG-image route and the page beside it.
      'node_modules/sharp/**',
      'node_modules/@img/**',
      // Vercel functions run on glibc; `npm ci` also installs the musl builds of native packages.
      'node_modules/**/*-linux-x64-musl/**',
      // og-card.tsx reads `public/<path>` with a dynamic path, so the tracer
      // pulls in all of public/. Only public/maps/ is ever read at runtime.
      'public/{weapon-icons,grenade-icons,kill-icons,round-icons,side-icons}/**',
    ],
  },
};

export default nextConfig;
