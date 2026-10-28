import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// portal.getCvUploadUrl is public and mints presigned S3 POSTs. It is capped per client (the
// `cvUpload` tier, keyed by trusted IP for anonymous callers) and per vacancy. Exercised through the
// REAL publicProcedure middleware chain and the REAL in-memory limiter (no Upstash env).

const VACANCY_A = '11111111-1111-1111-1111-111111111111';
const VACANCY_B = '22222222-2222-2222-2222-222222222222';
const VACANCY_C = 'abcdef12-3456-4abc-8def-abcdefabcdef';
const ORG_ID = '33333333-3333-3333-3333-333333333333';

const findFirstOrThrow = vi.fn();
vi.mock('@tims/db', () => ({ db: { vacancy: { findFirstOrThrow } } }));

const createPresignedPostMock = vi.fn();
vi.mock('../../packages/api/src/lib/s3', () => ({
  createCvUploadPresignedPost: (...a: unknown[]) => createPresignedPostMock(...a),
}));

type Caller = {
  portal: {
    getCvUploadUrl(input: { vacancyId: string; fileName: string; contentType: string }): Promise<unknown>;
  };
};

async function loadCallerFactory() {
  vi.resetModules();
  vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { portalRouter } = await import('../../packages/api/src/routers/portal');
  const factory = createCallerFactory(router({ portal: portalRouter }));
  return (ip: string): Caller =>
    factory({
      user: null,
      headers: new Headers({ 'x-real-ip': ip }),
      supabaseAuth: null,
      externalAuth: null,
    } as never) as unknown as Caller;
}

const upload = (caller: Caller, vacancyId = VACANCY_A) =>
  caller.portal.getCvUploadUrl({ vacancyId, fileName: 'cv.pdf', contentType: 'application/pdf' });

describe('portal.getCvUploadUrl rate limits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-28T12:00:00Z'));
    findFirstOrThrow.mockResolvedValue({ organizationId: ORG_ID });
    createPresignedPostMock.mockResolvedValue({ url: 'https://s3.example.test', fields: {}, key: 'k' });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('allows 10 presigns per client IP per 10 minutes, then rejects with TOO_MANY_REQUESTS', async () => {
    const callerFor = await loadCallerFactory();
    const caller = callerFor('203.0.113.7');
    for (let i = 0; i < 10; i++) await expect(upload(caller)).resolves.toBeTruthy();
    await expect(upload(caller)).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    expect(createPresignedPostMock).toHaveBeenCalledTimes(10);

    // Another client is unaffected, and the first one recovers after the window.
    await expect(upload(callerFor('203.0.113.8'))).resolves.toBeTruthy();
    vi.advanceTimersByTime(10 * 60_000 + 1);
    await expect(upload(caller)).resolves.toBeTruthy();
  });

  it('caps presigns per vacancy at 100 per 10 minutes across many client IPs', async () => {
    const callerFor = await loadCallerFactory();
    for (let i = 0; i < 100; i++) await expect(upload(callerFor(`198.51.100.${i}`))).resolves.toBeTruthy();
    await expect(upload(callerFor('198.51.100.200'))).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    // A different vacancy has its own budget.
    await expect(upload(callerFor('198.51.100.201'), VACANCY_B)).resolves.toBeTruthy();
    expect(createPresignedPostMock).toHaveBeenCalledTimes(101);
  });

  it('counts UUID case variants of one vacancy against the same per-vacancy budget', async () => {
    const callerFor = await loadCallerFactory();
    const variants = [VACANCY_C, VACANCY_C.toUpperCase()];
    expect(variants[0]).not.toBe(variants[1]);
    for (let i = 0; i < 100; i++) await expect(upload(callerFor(`192.0.2.${i}`), variants[i % 2])).resolves.toBeTruthy();
    await expect(upload(callerFor('192.0.2.200'), VACANCY_C.toUpperCase())).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
    });
    await expect(upload(callerFor('192.0.2.201'), VACANCY_C)).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
  });
});
