import { createHash } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import es from '../../apps/web/lib/i18n/es.json';
import en from '../../apps/web/lib/i18n/en.json';
import {
  APPLICATION_CONSENT_TEXT,
  APPLICATION_CONSENT_TEXT_VERSION,
  APPLICATION_CONSENT_TYPE,
  renderApplicationConsentText,
} from '../../packages/shared/src/constants/application-consent';

// #313 — per-application consent evidence written by portal.applyToVacancy, and the guard that
// keeps the server's canonical consent text identical to what the apply form renders.

const VACANCY_ID = '11111111-1111-1111-1111-111111111111';
const ORG_ID = '22222222-2222-2222-2222-222222222222';
const CANDIDATE_ID = '33333333-3333-3333-3333-333333333333';
const STAGE_ID = '44444444-4444-4444-4444-444444444444';
const APPLICATION_ID = '55555555-5555-5555-5555-555555555555';

const dbMocks = {
  vacancy: { findFirstOrThrow: vi.fn() },
  candidate: { findMany: vi.fn(), create: vi.fn() },
  dataConsent: { upsert: vi.fn(), findFirst: vi.fn() },
  application: { findFirst: vi.fn(), create: vi.fn() },
  applicationConsentEvidence: { create: vi.fn() },
  pipelineStage: { findFirstOrThrow: vi.fn() },
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(dbMocks)),
};

vi.mock('@tims/db', () => ({ db: dbMocks }));
vi.mock('../../packages/api/src/middleware/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue(undefined),
  getRateLimitCategory: vi.fn().mockReturnValue('ai'),
  consumeApplicationEmailQuota: vi.fn().mockResolvedValue(false),
}));
vi.mock('../../packages/api/src/services/portal-application.service', () => ({
  portalApplicationService: { processCvUpload: vi.fn() },
}));
vi.mock('../../packages/api/src/services/email.service', () => ({
  emailService: { sendApplicationReceived: vi.fn().mockResolvedValue(true) },
}));
vi.mock('../../packages/api/src/lib/s3', () => ({ createCvUploadPresignedPost: vi.fn() }));

async function apply(input: Record<string, unknown>, headers: Headers = new Headers()) {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { portalRouter } = await import('../../packages/api/src/routers/portal');
  const caller = createCallerFactory(router({ portal: portalRouter }))({
    user: null,
    headers,
    supabaseAuth: null,
    externalAuth: null,
  } as never) as unknown as { portal: { applyToVacancy(i: Record<string, unknown>): Promise<unknown> } };
  return caller.portal.applyToVacancy(input);
}

const baseInput = {
  vacancyId: VACANCY_ID,
  firstName: 'Ana',
  lastName: 'Gomez',
  email: 'ana@example.com',
  consentAccepted: true,
  consentTextVersion: APPLICATION_CONSENT_TEXT_VERSION,
};

const sha256 = (v: string) => createHash('sha256').update(v, 'utf8').digest('hex');

function evidenceRow(): Record<string, unknown> {
  expect(dbMocks.applicationConsentEvidence.create).toHaveBeenCalledOnce();
  return (dbMocks.applicationConsentEvidence.create.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.vacancy.findFirstOrThrow.mockResolvedValue({
    id: VACANCY_ID,
    organizationId: ORG_ID,
    title: 'Analista',
    stages: [{ id: STAGE_ID, isDefault: true }],
    organization: { name: 'Acme S.A.S.' },
    company: { language: 'es' },
  });
  dbMocks.candidate.findMany.mockResolvedValue([]);
  dbMocks.candidate.create.mockResolvedValue({ id: CANDIDATE_ID });
  dbMocks.dataConsent.findFirst.mockResolvedValue(null);
  dbMocks.dataConsent.upsert.mockResolvedValue({ id: 'consent-1' });
  dbMocks.application.findFirst.mockResolvedValue(null);
  dbMocks.application.create.mockResolvedValue({ id: APPLICATION_ID });
  dbMocks.applicationConsentEvidence.create.mockResolvedValue({ id: 'evidence-1' });
  dbMocks.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(dbMocks));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('portal.applyToVacancy — per-application consent evidence (#313)', () => {
  it('writes one evidence row for the NEW application with version, server-computed text hash and time', async () => {
    await apply(baseInput);
    const row = evidenceRow();

    expect(row).toMatchObject({
      organizationId: ORG_ID,
      applicationId: APPLICATION_ID,
      candidateId: CANDIDATE_ID,
      consentType: APPLICATION_CONSENT_TYPE,
      textVersion: APPLICATION_CONSENT_TEXT_VERSION,
      locale: 'es',
      isBackfilled: false,
    });
    // The hash is of the exact sentence shown: Spanish text naming the ORGANIZATION (the controller).
    expect(row.textSha256).toBe(sha256(renderApplicationConsentText('es', 'Acme S.A.S.')));
    expect(row.agreedAt).toBeInstanceOf(Date);
  });

  it('hashes the English text when the form was shown in English', async () => {
    await apply({ ...baseInput, consentLocale: 'en' });
    const row = evidenceRow();
    expect(row.locale).toBe('en');
    expect(row.textSha256).toBe(sha256(renderApplicationConsentText('en', 'Acme S.A.S.')));
    expect(row.textSha256).not.toBe(sha256(renderApplicationConsentText('es', 'Acme S.A.S.')));
  });

  it('rejects an unknown locale before any write', async () => {
    await expect(apply({ ...baseInput, consentLocale: 'fr' })).rejects.toThrow();
    expect(dbMocks.candidate.findMany).not.toHaveBeenCalled();
  });

  it('stores an org-salted IP hash (never the raw IP) and a bounded, control-free user agent', async () => {
    const ua = `Mozilla/5.0\u0007 ${'x'.repeat(900)}`;
    await apply(baseInput, new Headers({ 'x-real-ip': '203.0.113.9', 'user-agent': ua }));
    const row = evidenceRow();

    expect(row.ipHash).toBe(sha256(`${ORG_ID}:203.0.113.9`));
    expect(JSON.stringify(row)).not.toContain('203.0.113.9');
    expect(typeof row.userAgent).toBe('string');
    expect((row.userAgent as string).length).toBe(512);
    expect(row.userAgent as string).not.toContain('\u0007');
  });

  it('leaves the IP hash and user agent null when the request carries neither', async () => {
    await apply(baseInput);
    expect(evidenceRow()).toMatchObject({ ipHash: null, userAgent: null });
  });

  it('records whether the captcha was actually verified', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'test-secret');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    await apply({ ...baseInput, captchaToken: 'tok' });
    expect(evidenceRow().captchaVerified).toBe(true);
  });

  it('writes the evidence inside the application transaction, after the application exists', async () => {
    const order: string[] = [];
    dbMocks.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      order.push('tx:start');
      const r = await fn(dbMocks);
      order.push('tx:end');
      return r;
    });
    dbMocks.application.create.mockImplementation(async () => {
      order.push('application');
      return { id: APPLICATION_ID };
    });
    dbMocks.applicationConsentEvidence.create.mockImplementation(async () => {
      order.push('evidence');
      return { id: 'evidence-1' };
    });

    await apply(baseInput);
    expect(order).toEqual(['tx:start', 'application', 'evidence', 'tx:end']);
  });

  it('a duplicate application writes no evidence (no application, no proof to attach it to)', async () => {
    dbMocks.application.findFirst.mockResolvedValue({ id: 'existing-app' });
    await apply(baseInput);
    expect(dbMocks.applicationConsentEvidence.create).not.toHaveBeenCalled();
  });

  it('a withdrawn candidate is refused: no application and no evidence (fresh consent cannot be claimed)', async () => {
    dbMocks.candidate.findMany.mockResolvedValue([
      { id: CANDIDATE_ID, email: 'ana@example.com', firstName: 'Ana', deletedAt: null },
    ]);
    dbMocks.dataConsent.findFirst.mockResolvedValue({ id: 'consent-1' });
    await expect(apply(baseInput)).resolves.toEqual({ received: true });
    expect(dbMocks.application.create).not.toHaveBeenCalled();
    expect(dbMocks.applicationConsentEvidence.create).not.toHaveBeenCalled();
  });

  it('an evidence write failure aborts the transaction (no application without its proof)', async () => {
    dbMocks.applicationConsentEvidence.create.mockRejectedValue(new Error('insert failed'));
    await expect(apply(baseInput)).rejects.toThrow();
  });
});

describe('canonical consent text matches the apply form (es/en i18n)', () => {
  it.each(['es', 'en'] as const)('%s: the server copy equals the portal.consentCheckbox* strings', (locale) => {
    const catalogue = (locale === 'es' ? es : en).portal;
    expect(APPLICATION_CONSENT_TEXT[locale]).toEqual({
      prefix: catalogue.consentCheckboxPrefix,
      middle: catalogue.consentCheckboxMiddle,
      policyLink: catalogue.consentPolicyLink,
      suffix: catalogue.consentCheckboxSuffix,
    });
  });

  it('renders the sentence the checkbox label reads', () => {
    expect(renderApplicationConsentText('es', 'Acme')).toBe(
      `${es.portal.consentCheckboxPrefix} Acme ${es.portal.consentCheckboxMiddle} ${es.portal.consentPolicyLink}${es.portal.consentCheckboxSuffix}`,
    );
  });
});
