import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Security headers (SECURITY-REVIEW L1). The CSP keeps 'unsafe-inline' for scripts because the
 * App Router injects inline bootstrap/RSC scripts and nonces would force every page through
 * middleware; there is no third-party script, font or API to allow. Dev adds 'unsafe-eval'
 * (React Refresh) and ws: for HMR. Tailwind compiles to a same-origin stylesheet; inline
 * style attributes (React `style`) need 'unsafe-inline' in style-src.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Staff URLs can carry ?q=<contact number>; other origins only ever see our origin.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
];

const nextConfig: NextConfig = {
  // Lets parallel dev servers in one checkout use separate build dirs (e.g. NEXT_DIST_DIR=.next-api).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // The old Vercel URL still resolves to this project. Send people (and bookmarks) to the real domain.
  // The cron endpoint and the Messenger webhook are excluded: they are called by machines that do not
  // follow redirects, and a redirect there would silently stop reminders or bot replies.
  async redirects() {
    return [
      {
        source: "/:path((?!api/cron|api/messenger).*)",
        has: [{ type: "host", value: "dentalclinic-sooty.vercel.app" }],
        destination: "https://molarandco.vercel.app/:path*",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
