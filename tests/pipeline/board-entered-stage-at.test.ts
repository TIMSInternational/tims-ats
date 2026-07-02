import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../packages/api/src/repositories/pipeline.repository', () => ({
  pipelineRepository: {
    vacancyExists: vi.fn(),
    getBoard: vi.fn(),
  },
}));

import { pipelineService } from '../../packages/api/src/services/pipeline.service';
import { pipelineRepository } from '../../packages/api/src/repositories/pipeline.repository';

const candidate = {
  id: 'c1',
  firstName: 'A',
  lastName: 'B',
  email: 'a@b.com',
  avatar: null,
  currentTitle: null,
  currentCompany: null,
};

beforeEach(() => vi.clearAllMocks());

describe('pipelineService.getBoard — enteredStageAt', () => {
  it('derives enteredStageAt from the latest movement, not appliedAt, once the card has moved stages', async () => {
    vi.mocked(pipelineRepository.vacancyExists).mockResolvedValue({ id: 'vac-1' } as never);
    const appliedAt = new Date('2026-01-01T00:00:00Z');
    const movedAt = new Date('2026-06-01T00:00:00Z');
    vi.mocked(pipelineRepository.getBoard).mockResolvedValue([
      {
        id: 'stage-1',
        name: 'Screening',
        order: 1,
        slaHours: 48,
        checklist: null,
        isDefault: false,
        applications: [
          { id: 'app-1', status: 'active', source: 'linkedin', appliedAt, movements: [{ movedAt }], candidate },
        ],
      },
    ] as never);

    const board = await pipelineService.getBoard('org-1', 'vac-1', 'active');
    const app = board.stages[0]!.applications[0]! as unknown as { enteredStageAt: Date };
    expect(app.enteredStageAt).toEqual(movedAt);
  });

  it('falls back to appliedAt when the application has never moved (still in its first stage)', async () => {
    vi.mocked(pipelineRepository.vacancyExists).mockResolvedValue({ id: 'vac-1' } as never);
    const appliedAt = new Date('2026-01-01T00:00:00Z');
    vi.mocked(pipelineRepository.getBoard).mockResolvedValue([
      {
        id: 'stage-1',
        name: 'Applied',
        order: 0,
        slaHours: 24,
        checklist: null,
        isDefault: true,
        applications: [
          { id: 'app-1', status: 'active', source: 'linkedin', appliedAt, movements: [], candidate },
        ],
      },
    ] as never);

    const board = await pipelineService.getBoard('org-1', 'vac-1', 'active');
    const app = board.stages[0]!.applications[0]! as unknown as { enteredStageAt: Date };
    expect(app.enteredStageAt).toEqual(appliedAt);
  });
});
