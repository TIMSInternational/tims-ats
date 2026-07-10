import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../packages/api/src/repositories/pipeline.repository', () => ({
  pipelineRepository: {
    findApplication: vi.fn(),
    stageExistsForVacancy: vi.fn(),
    getStageChecklist: vi.fn(),
    moveCandidate: vi.fn(),
    setChecklistItem: vi.fn(),
  },
}));

import { pipelineService } from '../../packages/api/src/services/pipeline.service';
import { pipelineRepository } from '../../packages/api/src/repositories/pipeline.repository';

const ORG = 'org-1';
const USER = 'user-1';
const APPLICATION_ID = 'app-1';
const SOURCE_STAGE_ID = 'stage-source';
const TARGET_STAGE_ID = 'stage-target';

function baseApplication(overrides: Partial<{ checklistProgress: unknown }> = {}) {
  return {
    id: APPLICATION_ID,
    vacancyId: 'vac-1',
    currentStageId: SOURCE_STAGE_ID,
    status: 'active',
    checklistProgress: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(pipelineRepository.stageExistsForVacancy).mockResolvedValue({ id: TARGET_STAGE_ID } as never);
  vi.mocked(pipelineRepository.moveCandidate).mockResolvedValue({
    id: APPLICATION_ID,
    status: 'active',
    appliedAt: new Date(),
    candidate: { id: 'c1', firstName: 'A', lastName: 'B', email: 'a@b.com', avatar: null },
    currentStage: { id: TARGET_STAGE_ID, name: 'Screening', order: 1 },
  } as never);
});

describe('pipelineService.moveCandidate — soft checklist gate', () => {
  it('(a) source stage has no checklist -> no warnings, unchanged behavior', async () => {
    vi.mocked(pipelineRepository.findApplication).mockResolvedValue(baseApplication() as never);
    vi.mocked(pipelineRepository.getStageChecklist).mockResolvedValue({
      id: SOURCE_STAGE_ID, name: 'Screening', checklist: null,
    } as never);

    const result = await pipelineService.moveCandidate(ORG, USER, APPLICATION_ID, TARGET_STAGE_ID);

    expect(result.warnings).toBeUndefined();
    expect(pipelineRepository.moveCandidate).toHaveBeenCalledWith(
      ORG, USER, APPLICATION_ID, SOURCE_STAGE_ID, TARGET_STAGE_ID, undefined,
    );
  });

  it('(b) source stage has an incomplete checklist -> the move still happens AND warnings name the incomplete items', async () => {
    vi.mocked(pipelineRepository.findApplication).mockResolvedValue(baseApplication({ checklistProgress: {} }) as never);
    vi.mocked(pipelineRepository.getStageChecklist).mockResolvedValue({
      id: SOURCE_STAGE_ID,
      name: 'Screening',
      checklist: [
        { key: 'cv_review', label: 'Revisar CV', completed: false },
        { key: 'ref_check', label: 'Verificar referencias', completed: false },
      ],
    } as never);

    const result = await pipelineService.moveCandidate(ORG, USER, APPLICATION_ID, TARGET_STAGE_ID);

    // The move must always succeed — this is a SOFT gate.
    expect(pipelineRepository.moveCandidate).toHaveBeenCalledTimes(1);
    expect(result.id).toBe(APPLICATION_ID);
    expect(result.warnings).toEqual(['Revisar CV', 'Verificar referencias']);
  });

  it('(b2) partial progress -> warnings only name the still-incomplete items', async () => {
    vi.mocked(pipelineRepository.findApplication).mockResolvedValue(baseApplication({
      checklistProgress: {
        [SOURCE_STAGE_ID]: {
          cv_review: { completed: true, completedBy: USER, completedAt: '2026-07-10T00:00:00.000Z' },
        },
      },
    }) as never);
    vi.mocked(pipelineRepository.getStageChecklist).mockResolvedValue({
      id: SOURCE_STAGE_ID,
      name: 'Screening',
      checklist: [
        { key: 'cv_review', label: 'Revisar CV', completed: false },
        { key: 'ref_check', label: 'Verificar referencias', completed: false },
      ],
    } as never);

    const result = await pipelineService.moveCandidate(ORG, USER, APPLICATION_ID, TARGET_STAGE_ID);

    expect(result.warnings).toEqual(['Verificar referencias']);
  });

  it('(c) all checklist items marked complete in checklistProgress -> no warnings', async () => {
    vi.mocked(pipelineRepository.findApplication).mockResolvedValue(baseApplication({
      checklistProgress: {
        [SOURCE_STAGE_ID]: {
          cv_review: { completed: true, completedBy: USER, completedAt: '2026-07-10T00:00:00.000Z' },
          ref_check: { completed: true, completedBy: USER, completedAt: '2026-07-10T00:00:00.000Z' },
        },
      },
    }) as never);
    vi.mocked(pipelineRepository.getStageChecklist).mockResolvedValue({
      id: SOURCE_STAGE_ID,
      name: 'Screening',
      checklist: [
        { key: 'cv_review', label: 'Revisar CV', completed: false },
        { key: 'ref_check', label: 'Verificar referencias', completed: false },
      ],
    } as never);

    const result = await pipelineService.moveCandidate(ORG, USER, APPLICATION_ID, TARGET_STAGE_ID);

    expect(result.warnings).toBeUndefined();
    expect(pipelineRepository.moveCandidate).toHaveBeenCalledTimes(1);
  });
});

describe('pipelineService.updateApplicationChecklist', () => {
  it('marks one item complete via a single atomic repository call — no separate read', async () => {
    vi.mocked(pipelineRepository.setChecklistItem).mockResolvedValue({
      id: APPLICATION_ID,
      currentStageId: SOURCE_STAGE_ID,
      checklistProgress: { [SOURCE_STAGE_ID]: { cv_review: { completed: true, completedBy: USER, completedAt: '2026-07-10T00:00:00.000Z' } } },
    } as never);

    await pipelineService.updateApplicationChecklist(ORG, USER, APPLICATION_ID, SOURCE_STAGE_ID, 'cv_review', true);

    // Regression guard for the lost-update fix: the service must go through
    // ONE atomic repository call (setChecklistItem) and must NOT also call
    // findApplication — a separate read-then-write is exactly the race this
    // fix removes.
    expect(pipelineRepository.setChecklistItem).toHaveBeenCalledTimes(1);
    expect(pipelineRepository.setChecklistItem).toHaveBeenCalledWith(
      ORG,
      APPLICATION_ID,
      SOURCE_STAGE_ID,
      'cv_review',
      expect.objectContaining({ completed: true, completedBy: USER }),
    );
    expect(pipelineRepository.findApplication).not.toHaveBeenCalled();
  });

  it('toggling a second item is a single call too — no read-merge-write to accumulate in JS', async () => {
    vi.mocked(pipelineRepository.setChecklistItem).mockResolvedValue({
      id: APPLICATION_ID,
      currentStageId: SOURCE_STAGE_ID,
      checklistProgress: {
        [SOURCE_STAGE_ID]: {
          cv_review: { completed: true, completedBy: USER, completedAt: '2026-07-10T00:00:00.000Z' },
          ref_check: { completed: true, completedBy: USER, completedAt: '2026-07-10T01:00:00.000Z' },
        },
      },
    } as never);

    const result = await pipelineService.updateApplicationChecklist(ORG, USER, APPLICATION_ID, SOURCE_STAGE_ID, 'ref_check', true);

    expect(pipelineRepository.setChecklistItem).toHaveBeenCalledTimes(1);
    expect(pipelineRepository.setChecklistItem).toHaveBeenCalledWith(
      ORG,
      APPLICATION_ID,
      SOURCE_STAGE_ID,
      'ref_check',
      expect.objectContaining({ completed: true, completedBy: USER }),
    );
    // The service trusts the DB-computed merged map back verbatim — it never
    // re-derives or re-merges it in JS.
    expect(result.checklistProgress).toEqual({
      [SOURCE_STAGE_ID]: {
        cv_review: expect.objectContaining({ completed: true }),
        ref_check: expect.objectContaining({ completed: true, completedBy: USER }),
      },
    });
  });

  it('throws NOT_FOUND when the atomic update matches zero rows (out-of-org or missing applicationId)', async () => {
    vi.mocked(pipelineRepository.setChecklistItem).mockResolvedValue(null as never);
    await expect(
      pipelineService.updateApplicationChecklist(ORG, USER, 'missing-app', SOURCE_STAGE_ID, 'cv_review', true),
    ).rejects.toThrow();
  });
});
