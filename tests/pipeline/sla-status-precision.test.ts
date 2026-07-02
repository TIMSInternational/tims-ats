import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../packages/api/src/repositories/pipeline.repository', () => ({
  pipelineRepository: {
    vacancyExists: vi.fn(),
    getStagesForVacancy: vi.fn(),
    getActiveApplicationsWithMovements: vi.fn(),
  },
}));

import { pipelineService } from '../../packages/api/src/services/pipeline.service';
import { pipelineRepository } from '../../packages/api/src/repositories/pipeline.repository';

const candidate = { id: 'c1', firstName: 'A', lastName: 'B' };

beforeEach(() => vi.clearAllMocks());

describe('pipelineService.getSlaStatus — hourly precision', () => {
  it('flags an application overdue on a sub-hour SLA breach, not just after a full extra hour', async () => {
    vi.mocked(pipelineRepository.vacancyExists).mockResolvedValue({ id: 'vac-1' } as never);
    vi.mocked(pipelineRepository.getStagesForVacancy).mockResolvedValue([
      { id: 'stage-1', name: 'Screening', order: 0, slaHours: 8 },
    ] as never);

    const now = Date.now();
    vi.mocked(pipelineRepository.getActiveApplicationsWithMovements).mockResolvedValue([
      {
        id: 'app-1',
        currentStageId: 'stage-1',
        appliedAt: new Date(now - 100 * 60 * 60 * 1000),
        candidate,
        // Entered this stage 8.5 hours ago against an 8h SLA — genuinely
        // overdue, but flooring to whole hours (8) would read 8 > 8 = false.
        movements: [{ movedAt: new Date(now - 8.5 * 60 * 60 * 1000) }],
      },
    ] as never);

    const result = await pipelineService.getSlaStatus('org-1', 'vac-1');

    expect(result.items[0]!.isOverdue).toBe(true);
  });
});
