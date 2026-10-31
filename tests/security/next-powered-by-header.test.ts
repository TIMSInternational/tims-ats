import { describe, expect, it } from 'vitest';
import nextConfig from '../../apps/web/next.config';

describe('next.config — framework fingerprint header', () => {
  it('disables the x-powered-by header (the exported, Sentry-wrapped config)', () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});
