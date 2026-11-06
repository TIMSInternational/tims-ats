import { beforeEach, describe, expect, it, vi } from 'vitest';

// B-26 / hiring-team ideal-76: an evaluator assigned to an interview panel gets a bell row linking to the room.
// The scheduler is never notified about their own action, and an empty recipient list writes nothing (it must
// never fall back to platform owners the way lib/notify.ts does).

const ORG = '11111111-1111-4111-8111-111111111111';
const INTERVIEW = '22222222-2222-4222-8222-222222222222';
const ACTOR = '33333333-3333-4333-8333-333333333333';
const EVA = '44444444-4444-4444-8444-444444444444';

const m = vi.hoisted(() => ({
  bulkCreate: vi.fn(),
  interviewSummary: vi.fn(),
  activeMembers: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@tims/db', () => ({ runWithTenant: (_org: string, fn: () => unknown) => fn() }));
vi.mock('@tims/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tims/shared')>()),
  logger: { warn: m.warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../packages/api/src/services/notification.service', () => ({
  notificationService: { bulkCreate: m.bulkCreate },
}));
vi.mock('../../packages/api/src/repositories/bell-notification.repository', () => ({
  bellNotificationRepository: { interviewSummary: m.interviewSummary, activeMembers: m.activeMembers },
}));

import { bellNotificationService } from '../../packages/api/src/services/bell-notification.service';

beforeEach(() => {
  vi.clearAllMocks();
  m.bulkCreate.mockResolvedValue({ count: 1 });
  m.interviewSummary.mockResolvedValue({ candidate: { firstName: 'Ana', lastName: 'Mora' }, vacancy: { title: 'Analista' } });
  m.activeMembers.mockResolvedValue([{ id: EVA, locale: 'es' }]);
});

describe('bellNotificationService.panelAssigned', () => {
  it('notifies the panel (not the scheduler) with a link to the interview room', async () => {
    await bellNotificationService.panelAssigned(ORG, INTERVIEW, [EVA, ACTOR, EVA], ACTOR);
    expect(m.activeMembers).toHaveBeenCalledWith(ORG, [EVA]);
    expect(m.bulkCreate).toHaveBeenCalledWith(ORG, [EVA], {
      type: 'info',
      title: 'Te asignaron a una entrevista: Ana Mora (Analista)',
      message: 'Abre la sala de la entrevista para ver los detalles y registrar tu calificación.',
      module: 'interview',
      entityType: 'interview',
      entityId: INTERVIEW,
      actionUrl: `/recruitment/interviews/${INTERVIEW}/room`,
    });
  });

  it('writes nothing when the only evaluator is the scheduler', async () => {
    await bellNotificationService.panelAssigned(ORG, INTERVIEW, [ACTOR], ACTOR);
    expect(m.activeMembers).not.toHaveBeenCalled();
    expect(m.bulkCreate).not.toHaveBeenCalled();
  });

  it('writes nothing for inactive recipients or an interview outside the organization', async () => {
    m.activeMembers.mockResolvedValue([]);
    await bellNotificationService.panelAssigned(ORG, INTERVIEW, [EVA], ACTOR);
    m.activeMembers.mockResolvedValue([{ id: EVA, locale: 'es' }]);
    m.interviewSummary.mockResolvedValue(null);
    await bellNotificationService.panelAssigned(ORG, INTERVIEW, [EVA], ACTOR);
    expect(m.bulkCreate).not.toHaveBeenCalled();
  });

  it('never throws', async () => {
    m.interviewSummary.mockRejectedValue(new Error('db down'));
    await expect(bellNotificationService.panelAssigned(ORG, INTERVIEW, [EVA], ACTOR)).resolves.toBeUndefined();
    expect(m.warn).toHaveBeenCalled();
  });
});
