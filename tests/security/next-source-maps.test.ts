import { afterEach, describe, expect, it, vi } from 'vitest';
import nextConfig from '../../apps/web/next.config';
import { canUploadSourceMaps, sentryBuildOptions } from '../../apps/web/lib/sentry-build-options';

const FULL = {
  SENTRY_AUTH_TOKEN: 'test-token',
  SENTRY_ORG: 'test-org',
  SENTRY_PROJECT: 'test-project',
  CI: '1',
} as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('next.config — browser source maps are never published', () => {
  it('keeps Next’s public browser source maps off on the exported (Sentry-wrapped) config', () => {
    expect(nextConfig.productionBrowserSourceMaps).toBe(false);
  });
});

describe('sentryBuildOptions — source maps only with all three upload credentials', () => {
  it('with token, org and project: maps are generated, uploaded and deleted after upload', () => {
    const options = sentryBuildOptions(FULL);

    expect(canUploadSourceMaps(FULL)).toBe(true);
    expect(options.sourcemaps?.disable).toBe(false);
    expect(options.sourcemaps?.deleteSourcemapsAfterUpload).toBe(true);
    expect(options.authToken).toBe('test-token');
    expect(options.org).toBe('test-org');
    expect(options.project).toBe('test-project');
  });

  it.each(['SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT'] as const)(
    'without %s (absent, empty or blank): source-map handling is disabled entirely',
    (missing) => {
      for (const value of [undefined, '', '   ']) {
        const env = { ...FULL, [missing]: value };

        expect(canUploadSourceMaps(env)).toBe(false);
        expect(sentryBuildOptions(env).sourcemaps).toEqual({ disable: true, deleteSourcemapsAfterUpload: true });
      }
    },
  );

  it('with no Sentry variables at all (local / preview builds): disabled, and quiet outside CI', () => {
    const options = sentryBuildOptions({});

    expect(options.sourcemaps?.disable).toBe(true);
    expect(options.authToken).toBeUndefined();
    expect(options.silent).toBe(true);
  });

  it('a failed upload or release step is logged and never fails the build', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { errorHandler } = sentryBuildOptions(FULL);

    expect(errorHandler).toBeTypeOf('function');
    expect(() => errorHandler?.(new Error('upload rejected'))).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('upload rejected');
  });
});
