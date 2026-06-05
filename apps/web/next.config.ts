import type { NextConfig } from "next";
import path from "node:path";
import { withSentryConfig } from "@sentry/nextjs";

// NOTE: Content-Security-Policy is set per-request in `middleware.ts` so it can
// carry a unique nonce (nonce-based CSP, no 'unsafe-inline' on script-src in
// prod). The static security headers below are request-independent and stay here.

const nextConfig: NextConfig = {
  devIndicators: false,
  // Monorepo: trace from the repo root so file tracing can see the pnpm store
  // (workspace packages + the Prisma query-engine binary live two levels up).
  outputFileTracingRoot: path.join(__dirname, "../../"),
  // Keep Prisma out of the webpack bundle so its native engine binary is
  // resolved/required from node_modules at runtime instead of being inlined.
  serverExternalPackages: ["@prisma/client", "prisma"],
  // Force the Linux query-engine binary into every serverless function bundle.
  // pnpm nests it under the hashed .pnpm store, which Next's tracing misses by
  // default — without this, runtime queries throw "Query Engine not found".
  outputFileTracingIncludes: {
    "**": [
      "../../node_modules/.pnpm/@prisma+client*/node_modules/.prisma/client/*.node",
    ],
  },
  transpilePackages: [
    "@tims/api",
    "@tims/auth",
    "@tims/db",
    "@tims/shared",
    "@tims/ui",
    "@tims/i18n",
  ],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-XSS-Protection", value: "1; mode=block" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=()" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ],
      },
    ];
  },
};

// Wrap with the Sentry build plugin. Org/project/token are read from env
// (.env.sentry-build-plugin locally, or CI/Vercel env), so no slugs are
// hardcoded and the wrapper is a no-op for source-map upload until a token is
// set. tunnelRoute is intentionally omitted — Sentry ingest is already allowed
// in the CSP connect-src, and a tunnel route would need middleware/auth carve-outs.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Upload a wider set of client files for better stack-trace resolution.
  widenClientFileUpload: true,
  // Quiet during local/non-CI builds.
  silent: !process.env.CI,
});
