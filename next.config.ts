import type { NextConfig } from "next";
import { securityHeaders } from "./src/infrastructure/security/headers";

const isDev = process.env.NODE_ENV !== "production";

const nextConfig: NextConfig = {
  // Produces a self-contained server bundle in .next/standalone, suitable for
  // container-based cloud hosting. See docs/DEPLOYMENT.md.
  output: "standalone",
  // The sample knowledge vault is read from disk at runtime; ship it with the
  // standalone server so the demo works there too.
  outputFileTracingIncludes: {
    "/": ["./knowledge/sample-vault/**/*.md"],
    "/knowledge": ["./knowledge/sample-vault/**/*.md"],
    "/knowledge/note": ["./knowledge/sample-vault/**/*.md"],
    "/*": ["./drizzle/**/*"],
  },
  poweredByHeader: false,
  // Database drivers run natively on the server (PGlite ships WebAssembly).
  serverExternalPackages: ["pg", "@electric-sql/pglite"],
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
