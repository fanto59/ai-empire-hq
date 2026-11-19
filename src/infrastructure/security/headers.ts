/**
 * HTTP security headers applied to every response (see next.config.ts).
 *
 * The Content-Security-Policy is deliberately strict: everything is same-origin
 * and no third-party script, font, or API host is allowed. When a real
 * integration is added, extend `connect-src` with the exact host only, and
 * document the change in docs/SECURITY.md.
 *
 * Future PixiJS note: PixiJS renders to <canvas> and may create blob: workers
 * or textures. `worker-src 'self' blob:` and `img-src blob:` are already
 * permitted for that reason.
 */
export interface SecurityHeaderOptions {
  isDev: boolean;
}

export function contentSecurityPolicy({ isDev }: SecurityHeaderOptions): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // Next.js inlines small bootstrap scripts; dev mode also needs eval for HMR.
    // TODO(security): move to nonce-based CSP once auth/middleware lands.
    "script-src": ["'self'", "'unsafe-inline'", ...(isDev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'"],
    "connect-src": ["'self'", ...(isDev ? ["ws:"] : [])],
    "worker-src": ["'self'", "blob:"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };

  const policy = Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");

  return isDev ? policy : `${policy}; upgrade-insecure-requests`;
}

export function securityHeaders(options: SecurityHeaderOptions): { key: string; value: string }[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(options) },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    // Private headquarters: ask crawlers not to index anything.
    { key: "X-Robots-Tag", value: "noindex, nofollow" },
  ];
}
