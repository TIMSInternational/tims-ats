import { describe, expect, it, vi } from 'vitest';
import {
  assertVacancyNotFilled,
  closeHireRecords,
  HireRejectedApplicationError,
  HireVacancyFilledError,
  HireWithdrawnApplicationError,
  isVacancyFilled,
  lockVacancyForHire,
  vacancyFilledMessage,
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
  transitioned?: number;
  applications?: Array<{ id: string; status: string; currentStageId: string }>;
  statusAfterRace?: string;
};

function tx(o: Opts = {}) {
  return {
    application: {
      findFirst: vi.fn().mockResolvedValue({ status: o.statusAfterRace ?? 'active' }),
      updateMany: vi.fn().mockResolvedValue({ count: o.transitioned ?? 1 }),
    },
    pipelineStage: {
      findFirst: vi.fn().mockResolvedValue(o.finalStage === undefined ? { id: 'stage-contratado' } : o.finalStage),
    },
    stageMovement: { create: vi.fn().mockResolvedValue({ id: 'mv-1' }) },
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('FROM applications')) {
        return (
          o.applications ??
          (o.application === undefined
            ? [{ id: APP_ID, status: 'active', currentStageId: 'stage-oferta' }]
            : o.application
              ? [o.application]
              : [])
        );
      }
      return o.vacancy === undefined ? [{ positions: 1, status: 'published' }] : o.vacancy ? [o.vacancy] : [];
    }),
    vacancy: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    offer: { count: vi.fn().mockResolvedValue(o.converted ?? 1) },
  };
}

type RawCall = [TemplateStringsArray, ...unknown[]];
const rawCalls = (t: ReturnType<typeof tx>, table: string) =>
  (t.$queryRaw.mock.calls as unknown as RawCall[]).filter(([strings]) => strings.join('?').includes(`FROM ${table}`));

const CAND = '55555555-5555-4555-8555-555555555555';
const input = { organizationId: ORG, vacancyId: VAC, applicationId: APP_ID, candidateId: CAND, hiredById: HR };

describe('closeHireRecords', () => {
  it('marks the application hired, moves it to the last stage and records the move', async () => {
    const t = tx();
    const result = await closeHireRecords(t as never, input);
    const [appStrings, ...appValues] = rawCalls(t, 'applications')[0]!;
    expect(appStrings.join('?')).toMatch(/FOR NO KEY UPDATE/);
    expect(appValues).toEqual([APP_ID, ORG, VAC]);
    expect(t.pipelineStage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { vacancyId: VAC, organizationId: ORG }, orderBy: { order: 'desc' } }),
    );
    expect(t.application.updateMany).toHaveBeenCalledWith({
      where: { id: APP_ID, organizationId: ORG, status: 'active' },
      data: { status: 'hired', currentStageId: 'stage-contratado' },
    });
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
    expect(t.application.updateMany).toHaveBeenCalled();
    expect(t.stageMovement.create).not.toHaveBeenCalled();
  });

  it('refuses the hire when the application was already rejected', async () => {
    const t = tx({ application: { id: APP_ID, status: 'rejected', currentStageId: 's' } });
    await expect(closeHireRecords(t as never, input)).rejects.toBeInstanceOf(HireRejectedApplicationError);
    expect(t.application.updateMany).not.toHaveBeenCalled();
    expect(rawCalls(t, 'vacancies')).toHaveLength(0);
  });

  it('refuses an unlinked hire when every application for the vacancy is rejected', async () => {
    const t = tx({
      applications: [
        { id: 'a1', status: 'rejected', currentStageId: 's' },
        { id: 'a2', status: 'rejected', currentStageId: 's' },
      ],
    });
    await expect(closeHireRecords(t as never, { ...input, applicationId: null })).rejects.toBeInstanceOf(
      HireRejectedApplicationError,
    );
  });

  // Codex review of release/pilot-ux-wave2 (P1): a candidate-withdrawn application (C-33) must close the
  // process like a rejection — no employee attached to an application the candidate left.
  it('refuses the hire when the candidate withdrew the linked application', async () => {
    const t = tx({ application: { id: APP_ID, status: 'withdrawn', currentStageId: 's' } });
    await expect(closeHireRecords(t as never, input)).rejects.toBeInstanceOf(HireWithdrawnApplicationError);
    expect(t.application.updateMany).not.toHaveBeenCalled();
    expect(rawCalls(t, 'vacancies')).toHaveLength(0);
  });

  it('refuses an unlinked hire when every application for the vacancy is closed and one was withdrawn', async () => {
    const t = tx({
      applications: [
        { id: 'a1', status: 'rejected', currentStageId: 's' },
        { id: 'a2', status: 'withdrawn', currentStageId: 's' },
      ],
    });
    await expect(closeHireRecords(t as never, { ...input, applicationId: null })).rejects.toBeInstanceOf(
      HireWithdrawnApplicationError,
    );
  });

  it('refuses the hire when a withdrawal committed after the read', async () => {
    const t = tx({ transitioned: 0, statusAfterRace: 'withdrawn' });
    await expect(closeHireRecords(t as never, input)).rejects.toBeInstanceOf(HireWithdrawnApplicationError);
    expect(t.stageMovement.create).not.toHaveBeenCalled();
    expect(rawCalls(t, 'vacancies')).toHaveLength(0);
  });

  it("closes the candidate's active application for the vacancy when the offer has no application link", async () => {
    const t = tx();
    const result = await closeHireRecords(t as never, { ...input, applicationId: null });
    const [appStrings, ...appValues] = rawCalls(t, 'applications')[0]!;
    expect(appStrings.join('?')).toMatch(/candidate_id[\s\S]*FOR NO KEY UPDATE/);
    expect(appValues).toEqual([ORG, VAC, CAND]);
    expect(t.application.updateMany).toHaveBeenCalled();
    expect(result.applicationClosed).toBe(true);
  });

  it('refuses the hire (rolling back the transaction) when a rejection committed after the read', async () => {
    const t = tx({ transitioned: 0, statusAfterRace: 'rejected' });
    await expect(closeHireRecords(t as never, input)).rejects.toBeInstanceOf(HireRejectedApplicationError);
    expect(t.stageMovement.create).not.toHaveBeenCalled();
    expect(rawCalls(t, 'vacancies')).toHaveLength(0);
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

  it('locks the vacancy row (FOR NO KEY UPDATE, tenant-scoped) before counting conversions', async () => {
    const t = tx({ vacancy: { positions: 2, status: 'published' }, converted: 2 });
    await closeHireRecords(t as never, input);
    expect(rawCalls(t, 'vacancies')).toHaveLength(1);
    const [strings, ...values] = rawCalls(t, 'vacancies')[0]!;
    expect(strings.join('?')).toMatch(/FROM vacancies[\s\S]*organization_id[\s\S]*FOR NO KEY UPDATE/);
    expect(values).toEqual([VAC, ORG]);
    expect(t.$queryRaw.mock.invocationCallOrder.at(-1)!).toBeLessThan(t.offer.count.mock.invocationCallOrder[0]!);
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

// F-15 (pilot proof run): a hire used to be accepted on a vacancy whose positions were already covered.
describe('filled-vacancy hire guards', () => {
  it('a vacancy is filled when its hires cover every position (at least one)', () => {
    expect(isVacancyFilled(0, 1)).toBe(false);
    expect(isVacancyFilled(1, 1)).toBe(true);
    expect(isVacancyFilled(1, 2)).toBe(false);
    expect(isVacancyFilled(2, 2)).toBe(true);
    expect(isVacancyFilled(1, 0)).toBe(true);
  });

  it('explains the refusal in Spanish with the counts', () => {
    expect(vacancyFilledMessage(1, 1)).toBe(
      'La vacante ya está cubierta: tiene 1 de 1 contratación registrada. No se puede registrar otra contratación para esta vacante.',
    );
    expect(vacancyFilledMessage(2, 2)).toContain('2 de 2 contrataciones registradas');
  });

  it('pre-check: refuses when converted offers cover the positions, passes otherwise', async () => {
    const counts = (positions: number, hires: number) => vi.fn().mockResolvedValue({ positions, hires });
    const ref = { organizationId: ORG, vacancyId: VAC };
    await expect(assertVacancyNotFilled(ref, counts(1, 1))).rejects.toBeInstanceOf(HireVacancyFilledError);
    await expect(assertVacancyNotFilled(ref, counts(2, 1))).resolves.toBeUndefined();
    // A vacancy outside the organization (no counts) is left to the transaction's own lookups.
    await expect(assertVacancyNotFilled(ref, vi.fn().mockResolvedValue(null))).resolves.toBeUndefined();
    const read = counts(1, 0);
    await assertVacancyNotFilled(ref, read);
    expect(read).toHaveBeenCalledWith(ORG, VAC);
  });

  it('in the transaction: locks the vacancy row (tenant-scoped) before counting, and refuses when filled', async () => {
    const t = tx({ vacancy: { positions: 1, status: 'closed' }, converted: 1 });
    await expect(lockVacancyForHire(t as never, { organizationId: ORG, vacancyId: VAC })).rejects.toMatchObject({
      hires: 1,
      positions: 1,
    });
    const [strings, ...values] = rawCalls(t, 'vacancies')[0]!;
    expect(strings.join('?')).toContain('FOR NO KEY UPDATE');
    expect(values).toEqual([VAC, ORG]);
    expect(t.$queryRaw.mock.invocationCallOrder[0]!).toBeLessThan(t.offer.count.mock.invocationCallOrder[0]!);

    const open = tx({ vacancy: { positions: 2, status: 'published' }, converted: 1 });
    await expect(lockVacancyForHire(open as never, { organizationId: ORG, vacancyId: VAC })).resolves.toBeUndefined();
  });
});
