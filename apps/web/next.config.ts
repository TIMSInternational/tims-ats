import type { NextConfig } from "next";
import path from "node:path";
import { withSentryConfig } from "@sentry/nextjs";
import { permissionsPolicy } from "./lib/security/permissions-policy";

// NOTE: Content-Security-Policy is set per-request in `middleware.ts` so it can
// carry a unique nonce (nonce-based CSP, no 'unsafe-inline' on script-src in
// prod). The static security headers below are request-independent and stay here.

const nextConfig: NextConfig = {
  devIndicators: false,
  // No `x-powered-by: Next.js` response header (do not advertise the framework).
  poweredByHeader: false,
  // Mirror Vercel's server-only VERCEL_ENV into client bundles so getAppUrl()
  // (packages/shared/src/app-url.ts) can recognise a deployed environment in the
  // browser without depending on the project's "Automatically expose System
  // Environment Variables" setting (#50). Empty string = not a Vercel deployment.
  env: {
    NEXT_PUBLIC_VERCEL_ENV: process.env.VERCEL_ENV || process.env.NEXT_PUBLIC_VERCEL_ENV || "",
  },
  // Monorepo: trace from the repo root so file tracing can see the pnpm store
  // (workspace packages + the Prisma query-engine binary live two levels up).
  outputFileTracingRoot: path.join(__dirname, "../../"),
  // Keep Prisma out of the webpack bundle so its native engine binary is
  // resolved/required from node_modules at runtime instead of being inlined.
  //
  // pdf-parse (CV text extraction, packages/api/src/lib/cv-extraction.ts) runs as
  // plain Node code, never through webpack: it picks its pdf.js build with a
  // template-literal require, and pdf.js 1.10 loads its fake worker through
  // require.ensure, which webpack rewrites into a context module over all four
  // bundled pdf.js builds plus an async chunk. (F-7: PDF CVs have never parsed in
  // production, while the same file parses in plain Node.)
  // Next only externalizes a package that resolves from THIS app's root (the
  // base-resolve check in next/dist/build/handle-externals.js); one declared only by
  // a workspace package is silently bundled anyway. So pdf-parse is also an apps/web
  // dependency, with the same spec as packages/api (one copy in the lockfile).
  serverExternalPackages: ["@prisma/client", "prisma", "pdf-parse"],
  // Force the Linux query-engine binary into every serverless function bundle.
  // pnpm nests it under the hashed .pnpm store, which Next's tracing misses by
  // default — without this, runtime queries throw "Query Engine not found".
  // The pdf.js build pdf-parse runs (cv-extraction.ts PDFJS_BUILD_VERSION) is listed
  // explicitly too. Next's tracer currently expands pdf-parse's template-literal require
  // to all four builds and follows pdf.js's require.ensure worker load, but the build
  // that runs must not depend on that heuristic.
  outputFileTracingIncludes: {
    "**": [
      "../../node_modules/.pnpm/@prisma+client*/node_modules/.prisma/client/*.node",
      "../../node_modules/.pnpm/pdf-parse@*/node_modules/pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js",
      "../../node_modules/.pnpm/pdf-parse@*/node_modules/pdf-parse/lib/pdf.js/v1.10.100/build/pdf.worker.js",
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
          { key: "Permissions-Policy", value: permissionsPolicy(process.env.NEXT_PUBLIC_ASSESSMENT_PLAYER_ORIGIN) },
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
