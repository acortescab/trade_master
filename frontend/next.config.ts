import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

// Production builds are a static export served by FastAPI on the same origin.
// In `next dev`, /api is proxied to the local backend (rewrites don't apply to exports).
export default function config(phase: string): NextConfig {
  const base: NextConfig = {
    output: "export",
    images: { unoptimized: true },
  };
  if (phase !== PHASE_DEVELOPMENT_SERVER) return base;

  const backend = process.env.BACKEND_URL ?? "http://localhost:8000";
  return {
    ...base,
    output: undefined,
    async rewrites() {
      return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
    },
  };
}
