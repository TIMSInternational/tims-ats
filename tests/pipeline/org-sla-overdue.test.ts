import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../packages/api/src/repositories/pipeline.repository', () => ({
  pipelineRepository: {
    getActiveApplicationsForOrgSla: vi.fn(),
  },
}));

import { pipelineAnalyticsService } from '../../packages/api/src/services/pipeline-analytics.service';
import { pipelineRepository } from '../../packages/api/src/repositories/pipeline.repository';

beforeEach(() => vi.clearAllMocks());

describe('pipelineAnalyticsService.getOrgSlaOverdueCount', () => {
  it('counts an application overdue using time-in-CURRENT-stage, not time since application', async () => {
    const now = Date.now();
    vi.mocked(pipelineRepository.getActiveApplicationsForOrgSla).mockResolvedValue([
      {
        id: 'app-1',
        // Applied 100 days ago (would look overdue against a 48h SLA if
        // measured from appliedAt), but only entered the current stage 1 hour
        // ago — well within the 48h SLA. Must NOT count as overdue.
        appliedAt: new Date(now - 100 * 24 * 60 * 60 * 1000),
        currentStage: { slaHours: 48 },
        movements: [{ movedAt: new Date(now - 1 * 60 * 60 * 1000) }],
      },
      {
        id: 'app-2',
        // Entered current stage 72 hours ago, SLA is 48h -> genuinely overdue.
        appliedAt: new Date(now - 72 * 60 * 60 * 1000),
        currentStage: { slaHours: 48 },
        movements: [],
      },
      {
        id: 'app-3',
        // No SLA configured for this stage -> never overdue.
        appliedAt: new Date(now - 500 * 60 * 60 * 1000),
        currentStage: { slaHours: null },
        movements: [],
      },
    ] as never);

    const count = await pipelineAnalyticsService.getOrgSlaOverdueCount('org-1', {});

    expect(count).toBe(1);
  });
});
