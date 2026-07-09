import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../../packages/api/src/repositories/entitlement.repository', () => ({
  getModuleUsageQuantity: vi.fn(),
}));
import * as repo from '../../packages/api/src/repositories/entitlement.repository';
import { getModuleUsage, METERED_MODULE_USAGE } from '../../packages/api/src/services/usage-metering.service';

beforeEach(() => { vi.clearAllMocks(); });

it('maps ai_voice_interview to minutes via the ai-voice-interview slug', async () => {
  vi.mocked(repo.getModuleUsageQuantity).mockResolvedValue(120);
  const out = await getModuleUsage('org-1', 'ai_voice_interview', new Date(0), new Date(1));
  expect(out).toEqual({ quantity: 120, unit: 'minutes' });
  expect(repo.getModuleUsageQuantity).toHaveBeenCalledWith('org-1', ['ai-voice-interview'], 'durationMinutes', expect.any(Date), expect.any(Date));
});

it('maps ai_screening to screenings via candidate-screener count', async () => {
  vi.mocked(repo.getModuleUsageQuantity).mockResolvedValue(5);
  const out = await getModuleUsage('org-1', 'ai_screening', new Date(0), new Date(1));
  expect(out).toEqual({ quantity: 5, unit: 'screenings' });
  expect(repo.getModuleUsageQuantity).toHaveBeenCalledWith('org-1', ['candidate-screener'], 'count', expect.any(Date), expect.any(Date));
});

it('returns null for an unmapped module', async () => {
  const out = await getModuleUsage('org-1', 'vacancies', new Date(0), new Date(1));
  expect(out).toBeNull();
  expect(repo.getModuleUsageQuantity).not.toHaveBeenCalled();
});

it('exposes exactly the two usage-bearing modules', () => {
  expect(Object.keys(METERED_MODULE_USAGE).sort()).toEqual(['ai_screening', 'ai_voice_interview']);
});
