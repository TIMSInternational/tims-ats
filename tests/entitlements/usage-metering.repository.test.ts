import { describe, it, expect, vi, beforeEach } from 'vitest';
const mockDb = vi.hoisted(() => ({
  aiAgentUsageLog: { count: vi.fn(), aggregate: vi.fn() },
}));
vi.mock('@tims/db', () => ({ db: mockDb }));
import { getModuleUsageQuantity } from '../../packages/api/src/repositories/entitlement.repository';

beforeEach(() => { vi.clearAllMocks(); });

describe('getModuleUsageQuantity', () => {
  const start = new Date('2026-07-01T00:00:00Z');
  const end = new Date('2026-07-31T23:59:59Z');

  it('count aggregate: counts rows for the mapped slugs in range', async () => {
    mockDb.aiAgentUsageLog.count.mockResolvedValue(42);
    const n = await getModuleUsageQuantity('org-1', ['candidate-screener'], 'count', start, end);
    expect(n).toBe(42);
    const arg = mockDb.aiAgentUsageLog.count.mock.calls[0][0];
    expect(arg.where).toMatchObject({
      organizationId: 'org-1',
      agent: { slug: { in: ['candidate-screener'] } },
      createdAt: { gte: start, lte: end },
    });
  });

  it('durationMinutes aggregate: sums latencyMs and divides by 60000', async () => {
    mockDb.aiAgentUsageLog.aggregate.mockResolvedValue({ _sum: { latencyMs: 600000 } }); // 10 min
    const n = await getModuleUsageQuantity('org-1', ['ai-voice-interview'], 'durationMinutes', start, end);
    expect(n).toBe(10);
  });

  it('durationMinutes with no usage returns 0 (null _sum)', async () => {
    mockDb.aiAgentUsageLog.aggregate.mockResolvedValue({ _sum: { latencyMs: null } });
    const n = await getModuleUsageQuantity('org-1', ['ai-voice-interview'], 'durationMinutes', start, end);
    expect(n).toBe(0);
  });
});
