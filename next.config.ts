import type { NextConfig } from "next";
import { securityHeaders } from "./src/infrastructure/security/headers";

const isDev = process.env.NODE_ENV !== "production";

const nextConfig: NextConfig = {
  // Produces a self-contained server bundle in .next/standalone, suitable for
  // container-based cloud hosting. See docs/DEPLOYMENT.md.
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders({ isDev }),
      },
    ];
  },
};

export default nextConfig;
