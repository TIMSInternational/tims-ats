import type { SentryBuildOptions } from '@sentry/nextjs';

// Build-time Sentry options for next.config.ts (withSentryConfig). Kept in a function of the environment so the
// gating below is unit-tested (tests/security/next-source-maps.test.ts) without running `next build`.
//
// Source maps:
//   - all three of SENTRY_AUTH_TOKEN / SENTRY_ORG / SENTRY_PROJECT set → browser maps are generated as HIDDEN maps
//     (no sourceMappingURL comment in the served JS), uploaded, then deleted from the build output before it is
//     deployed, so they are never served;
//   - any of them missing → source-map handling is disabled outright: no maps are generated, nothing is uploaded,
//     and the build proceeds normally.
// A failed upload or release step (Sentry unreachable, revoked token) is logged and the build continues: error
// reporting must never block a production deploy. The `finally` delete still runs in that case.

type BuildEnv = Readonly<Record<string, string | undefined>>;

const present = (value: string | undefined): value is string => typeof value === 'string' && value.trim() !== '';

/** True only when every variable a source-map upload needs is set. */
export function canUploadSourceMaps(env: BuildEnv): boolean {
  return present(env.SENTRY_AUTH_TOKEN) && present(env.SENTRY_ORG) && present(env.SENTRY_PROJECT);
}

export function sentryBuildOptions(env: BuildEnv): SentryBuildOptions {
  const upload = canUploadSourceMaps(env);
  return {
    org: env.SENTRY_ORG,
    project: env.SENTRY_PROJECT,
    authToken: env.SENTRY_AUTH_TOKEN,
    // Upload a wider set of client files for better stack-trace resolution.
    widenClientFileUpload: true,
    sourcemaps: {
      disable: !upload,
      deleteSourcemapsAfterUpload: true,
    },
    // Quiet during local/non-CI builds.
    silent: !env.CI,
    errorHandler: (error: Error) => {
      console.warn(`[sentry] source map upload / release step failed; continuing the build: ${error.message}`);
    },
  };
}
