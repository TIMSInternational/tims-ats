import { describe, expect, it, vi } from 'vitest';
import {
  closeHireRecords,
  HIRE_STAGE_MOVE_REASON,
  VACANCY_FILLED_REASON,
} from '../../packages/api/src/services/hire-closure.service';

const ORG = '11111111-1111-4111-8111-111111111111';
const VAC = '22222222-2222-4222-8222-222222222222';
const APP_ID = '33333333-3333-4333-8333-333333333333';
const HR = '44444444-4444-4444-8444-444444444444';

type Opts = {
  application?: { id: string; status: string; currentStageId: string } | null;
  finalStage?: { id: string } | null;
  vacancy?: { positions: number; status: string } | null;
  converted?: number;
};

function tx(o: Opts = {}) {
  return {
    application: {
      findFirst: vi
        .fn()
        .mockResolvedValue(
          o.application === undefined
            ? { id: APP_ID, status: 'active', currentStageId: 'stage-oferta' }
            : o.application,
        ),
      update: vi.fn().mockResolvedValue({ id: APP_ID }),
    },
    pipelineStage: {
      findFirst: vi.fn().mockResolvedValue(o.finalStage === undefined ? { id: 'stage-contratado' } : o.finalStage),
    },
    stageMovement: { create: vi.fn().mockResolvedValue({ id: 'mv-1' }) },
    $queryRaw: vi
      .fn()
      .mockResolvedValue(
        o.vacancy === undefined ? [{ positions: 1, status: 'published' }] : o.vacancy ? [o.vacancy] : [],
      ),
    vacancy: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    offer: { count: vi.fn().mockResolvedValue(o.converted ?? 1) },
  };
}

const input = { organizationId: ORG, vacancyId: VAC, applicationId: APP_ID, hiredById: HR };

describe('closeHireRecords', () => {
  it('marks the application hired, moves it to the last stage and records the move', async () => {
    const t = tx();
    const result = await closeHireRecords(t as never, input);
    expect(t.application.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: APP_ID, organizationId: ORG, vacancyId: VAC } }),
    );
    expect(t.pipelineStage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { vacancyId: VAC, organizationId: ORG }, orderBy: { order: 'desc' } }),
    );
    expect(t.application.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: APP_ID }, data: { status: 'hired', currentStageId: 'stage-contratado' } }),
    );
    expect(t.stageMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          organizationId: ORG,
          applicationId: APP_ID,
          fromStageId: 'stage-oferta',
          toStageId: 'stage-contratado',
          movedBy: HR,
          reason: HIRE_STAGE_MOVE_REASON,
        },
      }),
    );
    expect(result.applicationClosed).toBe(true);
  });

  it('does not record a move when the application is already in the last stage', async () => {
    const t = tx({ application: { id: APP_ID, status: 'active', currentStageId: 'stage-contratado' } });
    await closeHireRecords(t as never, input);
    expect(t.application.update).toHaveBeenCalled();
    expect(t.stageMovement.create).not.toHaveBeenCalled();
  });

  it('leaves a non-active application untouched', async () => {
    const t = tx({ application: { id: APP_ID, status: 'rejected', currentStageId: 's' } });
    const result = await closeHireRecords(t as never, input);
    expect(t.application.update).not.toHaveBeenCalled();
    expect(result.applicationClosed).toBe(false);
  });

  it('skips the application step when the offer has no application', async () => {
    const t = tx();
    await closeHireRecords(t as never, { ...input, applicationId: null });
    expect(t.application.findFirst).not.toHaveBeenCalled();
  });

  it('closes a published vacancy once converted offers cover every position', async () => {
    const t = tx({ vacancy: { positions: 2, status: 'published' }, converted: 2 });
    const result = await closeHireRecords(t as never, input);
    expect(t.offer.count).toHaveBeenCalledWith({ where: { vacancyId: VAC, organizationId: ORG, status: 'converted' } });
    expect(t.vacancy.updateMany).toHaveBeenCalledWith({
      where: { id: VAC, organizationId: ORG, status: { in: ['approved', 'published'] } },
      data: expect.objectContaining({ status: 'closed', closedReason: VACANCY_FILLED_REASON }),
    });
    expect(result.vacancyClosed).toBe(true);
  });

  it('locks the vacancy row (FOR UPDATE, tenant-scoped) before counting conversions', async () => {
    const t = tx({ vacancy: { positions: 2, status: 'published' }, converted: 2 });
    await closeHireRecords(t as never, input);
    expect(t.$queryRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = t.$queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(strings.join('?')).toMatch(/FROM vacancies[\s\S]*organization_id[\s\S]*FOR UPDATE/);
    expect(values).toEqual([VAC, ORG]);
    expect(t.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(t.offer.count.mock.invocationCallOrder[0]);
  });

  it('does nothing to the vacancy when it is not found in the tenant', async () => {
    const t = tx({ vacancy: null });
    const result = await closeHireRecords(t as never, input);
    expect(t.offer.count).not.toHaveBeenCalled();
    expect(result.vacancyClosed).toBe(false);
  });

  it('keeps the vacancy open while positions remain', async () => {
    const t = tx({ vacancy: { positions: 3, status: 'published' }, converted: 2 });
    const result = await closeHireRecords(t as never, input);
    expect(t.vacancy.updateMany).not.toHaveBeenCalled();
    expect(result.vacancyClosed).toBe(false);
  });

  it('never closes a draft, frozen or already-closed vacancy', async () => {
    for (const status of ['draft', 'frozen', 'closed']) {
      const t = tx({ vacancy: { positions: 1, status }, converted: 5 });
      await closeHireRecords(t as never, input);
      expect(t.vacancy.updateMany).not.toHaveBeenCalled();
    }
  });
});
