import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  resolveRateLimitMultiplier,
  E2E_RATE_LIMIT_MULTIPLIER_MAX,
} from '../../packages/api/src/middleware/rate-limit';

// #330: the E2E stack raises the in-memory rate-limit ceiling so Playwright personas (one user, many
// browser contexts, retries re-running the journey) do not trip the per-user 100/min tier. The override
// must be IGNORED by production. The E2E stack itself runs NODE_ENV=production (it serves `next build`
// output), so the explicit TIMS_E2E_STACK=1 marker — not NODE_ENV — is what lets it through there.

describe('resolveRateLimitMultiplier — production ignores the E2E override', () => {
  it('production without the explicit E2E marker ignores the multiplier', () => {
    expect(resolveRateLimitMultiplier({ NODE_ENV: 'production', TIMS_E2E_RATE_LIMIT_MULTIPLIER: '50' })).toBe(1);
  });

  it('production with a marker that is not exactly "1" ignores the multiplier', () => {
    for (const marker of ['true', 'yes', '0', ' 1', '']) {
      expect(
        resolveRateLimitMultiplier({
          NODE_ENV: 'production',
          TIMS_E2E_STACK: marker,
          TIMS_E2E_RATE_LIMIT_MULTIPLIER: '50',
        }),
      ).toBe(1);
    }
  });

  it('a Vercel deployment ignores it even with the E2E marker set', () => {
    const base = { NODE_ENV: 'production', TIMS_E2E_STACK: '1', TIMS_E2E_RATE_LIMIT_MULTIPLIER: '50' };
    expect(resolveRateLimitMultiplier({ ...base, VERCEL: '1' })).toBe(1);
    expect(resolveRateLimitMultiplier({ ...base, VERCEL_ENV: 'production' })).toBe(1);
    expect(resolveRateLimitMultiplier({ ...base, NODE_ENV: 'development', VERCEL_ENV: 'preview' })).toBe(1);
  });

  it('the E2E stack (production build + explicit marker, no Vercel) honours it', () => {
    expect(
      resolveRateLimitMultiplier({
        NODE_ENV: 'production',
        TIMS_E2E_STACK: '1',
        TIMS_E2E_RATE_LIMIT_MULTIPLIER: '50',
        VERCEL: '',
        VERCEL_ENV: '',
      }),
    ).toBe(50);
  });

  it('non-production honours it without the marker', () => {
    expect(resolveRateLimitMultiplier({ NODE_ENV: 'test', TIMS_E2E_RATE_LIMIT_MULTIPLIER: '7' })).toBe(7);
  });

  it('unset, empty, malformed, zero or negative values fall back to 1; huge values are capped', () => {
    const ok = { NODE_ENV: 'test' };
    expect(resolveRateLimitMultiplier(ok)).toBe(1);
    for (const v of ['', '0', '-5', '1.5', 'abc', '1e3', '50x', '00050', '10000']) {
      expect(resolveRateLimitMultiplier({ ...ok, TIMS_E2E_RATE_LIMIT_MULTIPLIER: v }), v).toBe(1);
    }
    expect(resolveRateLimitMultiplier({ ...ok, TIMS_E2E_RATE_LIMIT_MULTIPLIER: '9999' })).toBe(
      E2E_RATE_LIMIT_MULTIPLIER_MAX,
    );
  });
});

describe('checkRateLimit — the multiplier is applied (or not) end to end on the in-memory limiter', () => {
  async function loadWith(env: Record<string, string>) {
    vi.resetModules();
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    vi.stubEnv('VERCEL', '');
    vi.stubEnv('VERCEL_ENV', '');
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    return import('../../packages/api/src/middleware/rate-limit');
  }

  async function countAllowed(mod: Awaited<ReturnType<typeof loadWith>>, user: string, attempts: number) {
    let allowed = 0;
    for (let i = 0; i < attempts; i++) {
      try {
        await mod.checkRateLimit(user, 'query');
        allowed++;
      } catch (e) {
        expect((e as { code?: string }).code).toBe('TOO_MANY_REQUESTS');
      }
    }
    return allowed;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('production-shaped env with the multiplier but WITHOUT the marker keeps the 100/min query tier', async () => {
    const mod = await loadWith({ NODE_ENV: 'production', TIMS_E2E_RATE_LIMIT_MULTIPLIER: '50' });
    expect(await countAllowed(mod, 'prod-user', 150)).toBe(100);
  });

  it('the E2E stack env (marker + multiplier) raises the query tier accordingly', async () => {
    const mod = await loadWith({ NODE_ENV: 'production', TIMS_E2E_STACK: '1', TIMS_E2E_RATE_LIMIT_MULTIPLIER: '3' });
    expect(await countAllowed(mod, 'e2e-user', 350)).toBe(300);
  });
});

describe('the E2E stack actually sets it', () => {
  it('scripts/e2e/up.sh writes the marker and the multiplier into web.env', () => {
    const upSh = readFileSync(join(__dirname, '../../scripts/e2e/up.sh'), 'utf8');
    expect(upSh).toMatch(/^TIMS_E2E_STACK=1$/m);
    expect(upSh).toMatch(/^TIMS_E2E_RATE_LIMIT_MULTIPLIER=[1-9][0-9]*$/m);
  });
});
