import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PIPELINE_STAGES } from '../../packages/api/src/routers/vacancy/default-stages';

// Founder request (pilot call 2026-11-05): sending an offer for signature moves the candidate to the vacancy's
// "Oferta" stage when they are still in an earlier one (services/offer-stage-advance.service.ts). Never
// backwards, never a rejected / withdrawn / hired application, with a StageMovement "Oferta enviada", inside
// the send transaction and under the application lock it takes FIRST.

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const OFFER_ID = '22222222-2222-4222-8222-222222222222';
const SENDER_ID = '33333333-3333-4333-8333-333333333333';
const APP_ID = '44444444-4444-4444-8444-444444444444';
const VACANCY_ID = '55555555-5555-4555-8555-555555555555';
const CANDIDATE_ID = '66666666-6666-4666-8666-666666666666';

// The default pipeline, as a vacancy has it (ids are the stage index).
const STAGES = DEFAULT_PIPELINE_STAGES.map((stage, order) => ({ id: `stage-${order}`, name: stage.name, order }));
const stageId = (name: string) => STAGES.find((stage) => stage.name === name)!.id;

const m = vi.hoisted(() => ({
  sql: [] as string[],
  application: { id: '', status: 'active', currentStageId: '' },
  offerUpdateCount: 1,
  appUpdateCount: 1,
  stages: [] as Array<{ id: string; name: string; order: number }>,
  offerUpdateMany: vi.fn(),
  appUpdateMany: vi.fn(),
  movementCreate: vi.fn(),
  stagesFindMany: vi.fn(),
  sendOffer: vi.fn(),
}));

vi.mock('@tims/db', () => {
  const tenantDb = {
    offer: {
      findFirst: vi.fn(async () => ({
        id: OFFER_ID,
        status: 'approved',
        settings: {},
        updatedAt: new Date('2026-11-01T10:00:00Z'),
        sentAt: null,
        expiresAt: null,
        vacancyId: VACANCY_ID,
        applicationId: APP_ID,
        candidateId: CANDIDATE_ID,
        candidate: {
          id: CANDIDATE_ID,
          firstName: 'Ana',
          lastName: 'Prueba',
          email: 'ana@example.test',
          updatedAt: new Date(),
        },
        vacancy: { title: 'Analista', company: null },
      })),
      updateMany: m.offerUpdateMany,
      count: vi.fn(async () => 1),
    },
    offerApproval: { count: vi.fn(async () => 0), findFirst: vi.fn(async () => null) },
    application: { findMany: vi.fn(async () => [{ status: 'active' }]), updateMany: m.appUpdateMany },
    organization: { findFirst: vi.fn(async () => ({ name: 'Acme', settings: {}, billingEmail: null })) },
    pipelineStage: { findMany: m.stagesFindMany },
    stageMovement: { create: m.movementCreate },
    // Both application locks of the send: the stage advance's FOR NO KEY UPDATE, then the guard's FOR SHARE.
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      m.sql.push(sql);
      return sql.includes('FOR NO KEY UPDATE') ? [m.application] : [{ status: m.application.status }];
    }),
  };
  return {
    tenantDb,
    runTenantTransaction: async (_org: string, fn: (tx: unknown) => Promise<unknown>) => fn(tenantDb),
    runWithTenant: (_org: string, fn: () => unknown) => fn(),
  };
});
vi.mock('../../packages/api/src/repositories/candidate-consent.repository', () => ({
  candidateConsentRepository: { isRecruitmentConsentWithdrawn: vi.fn(async () => false) },
}));
vi.mock('../../packages/api/src/access', () => ({
  buildAccessForUser: vi.fn().mockResolvedValue({ allowed: true, scope: 'organization', roles: ['hr_admin'] }),
  createAnchorLoader: vi.fn().mockReturnValue(null),
  scopeWhereFor: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../packages/api/src/services/email.service', () => ({
  emailService: { sendOfferToCandidate: m.sendOffer },
}));

async function send() {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { offerSigningRouter } = await import('../../packages/api/src/routers/offer/signing');
  return createCallerFactory(router({ offer: offerSigningRouter }))({
    user: {
      id: SENDER_ID,
      organizationId: ORG_ID,
      roles: ['hr_admin'],
      isPlatformOwner: false,
      impersonatorId: null,
      email: 'hr@example.test',
      isActive: true,
    },
    headers: new Headers(),
    supabaseAuth: null,
    externalAuth: null,
  } as never).offer.generateSigningLink({ offerId: OFFER_ID });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = 'https://example.test';
  m.sql.length = 0;
  m.application = { id: APP_ID, status: 'active', currentStageId: stageId('Entrevista final') };
  m.offerUpdateCount = 1;
  m.appUpdateCount = 1;
  m.stages = STAGES;
  m.offerUpdateMany.mockImplementation(async () => ({ count: m.offerUpdateCount }));
  m.appUpdateMany.mockImplementation(async () => ({ count: m.appUpdateCount }));
  m.movementCreate.mockResolvedValue({ id: 'mv-1' });
  m.stagesFindMany.mockImplementation(async () => m.stages);
  m.sendOffer.mockResolvedValue(true);
});

describe('findOfferStage / decideOfferStageMove (pure)', () => {
  const svc = () => import('../../packages/api/src/services/offer-stage-advance.service');
  const app = (currentStageId: string, status = 'active') => [{ id: APP_ID, status, currentStageId }];

  it('finds the default "Oferta" stage, case- and accent-insensitively, the first one if repeated', async () => {
    const { findOfferStage } = await svc();
    expect(findOfferStage(STAGES)?.id).toBe(stageId('Oferta'));
    expect(
      findOfferStage([
        { id: 'x', name: '  OFERTA ', order: 3 },
        { id: 'y', name: 'Oférta', order: 1 },
      ])?.id,
    ).toBe('y');
    expect(findOfferStage([{ id: 'x', name: 'Propuesta', order: 0 }])).toBeNull();
  });

  it('moves only an active application from an EARLIER stage', async () => {
    const { decideOfferStageMove } = await svc();
    for (const earlier of [
      'Postulación recibida',
      'Preselección',
      'Entrevista con RR. HH.',
      'Prueba técnica',
      'Entrevista final',
    ]) {
      expect(decideOfferStageMove(app(stageId(earlier)), STAGES)).toMatchObject({
        kind: 'move',
        toStageId: stageId('Oferta'),
      });
    }
    expect(decideOfferStageMove(app(stageId('Oferta')), STAGES)).toEqual({ kind: 'skip', reason: 'not_earlier' });
    expect(decideOfferStageMove(app(stageId('Contratado')), STAGES)).toEqual({ kind: 'skip', reason: 'not_earlier' });
    expect(decideOfferStageMove(app('stage-unknown'), STAGES)).toEqual({ kind: 'skip', reason: 'not_earlier' });
    for (const status of ['rejected', 'withdrawn', 'hired']) {
      expect(decideOfferStageMove(app(stageId('Preselección'), status), STAGES)).toEqual({
        kind: 'skip',
        reason: 'no_active_application',
      });
    }
    const renamed = STAGES.map((stage) => (stage.name === 'Oferta' ? { ...stage, name: 'Propuesta formal' } : stage));
    expect(decideOfferStageMove(app(stageId('Preselección')), renamed)).toEqual({
      kind: 'skip',
      reason: 'no_offer_stage',
    });
  });
});

describe('offer.generateSigningLink moves the candidate to "Oferta"', () => {
  it('writes the move + a StageMovement "Oferta enviada" by the sender, compare-and-set on the source stage', async () => {
    await send();
    expect(m.appUpdateMany).toHaveBeenCalledWith({
      where: { id: APP_ID, organizationId: ORG_ID, status: 'active', currentStageId: stageId('Entrevista final') },
      data: { currentStageId: stageId('Oferta') },
    });
    expect(m.movementCreate).toHaveBeenCalledWith({
      data: {
        organizationId: ORG_ID,
        applicationId: APP_ID,
        fromStageId: stageId('Entrevista final'),
        toStageId: stageId('Oferta'),
        movedBy: SENDER_ID,
        reason: 'Oferta enviada',
      },
      select: { id: true },
    });
    expect(m.stagesFindMany.mock.calls[0]![0].where).toEqual({ vacancyId: VACANCY_ID, organizationId: ORG_ID });
  });

  it('locks the application FOR NO KEY UPDATE first, then the send re-checks it FOR SHARE, then sends', async () => {
    await send();
    expect(
      m.sql.map((sql) =>
        sql.includes('FOR NO KEY UPDATE') ? 'update-lock' : sql.includes('FOR SHARE') ? 'share' : sql,
      ),
    ).toEqual(['update-lock', 'share']);
    expect(m.sql[0]).toContain('organization_id = ?::uuid');
    expect(m.offerUpdateMany.mock.invocationCallOrder[0]!).toBeLessThan(m.appUpdateMany.mock.invocationCallOrder[0]!);
  });

  it('a send that lost its compare-and-set moves nothing (CONFLICT)', async () => {
    m.offerUpdateCount = 0;
    await expect(send()).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(m.appUpdateMany).not.toHaveBeenCalled();
    expect(m.movementCreate).not.toHaveBeenCalled();
  });

  it.each([
    ['already in "Oferta"', () => (m.application.currentStageId = stageId('Oferta'))],
    ['already "Contratado" (never backwards)', () => (m.application.currentStageId = stageId('Contratado'))],
    ['hired', () => (m.application.status = 'hired')],
    ['no "Oferta" stage on this vacancy', () => (m.stages = STAGES.filter((stage) => stage.name !== 'Oferta'))],
  ])('no-op when %s — the offer is still sent', async (_label, arrange) => {
    arrange();
    await expect(send()).resolves.toMatchObject({ emailDeliveryAccepted: true });
    expect(m.offerUpdateMany).toHaveBeenCalledTimes(1);
    expect(m.appUpdateMany).not.toHaveBeenCalled();
    expect(m.movementCreate).not.toHaveBeenCalled();
  });

  it('an application that changed under the compare-and-set writes no StageMovement', async () => {
    m.appUpdateCount = 0;
    await send();
    expect(m.appUpdateMany).toHaveBeenCalledTimes(1);
    expect(m.movementCreate).not.toHaveBeenCalled();
  });
});
