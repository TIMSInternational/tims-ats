// tests/entitlements/ai-interview-access.entitlement.test.ts
// Task 5: assertAiInterviewEnabled is gated by requireEntitlement('ai_voice_interview'),
// not by aiAgentOrgConfig.enabled. Pure unit test — entitlement service + db are mocked.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';

vi.mock('../../packages/api/src/services/entitlement.service', () => ({
  requireEntitlement: vi.fn(),
  hasEntitlement: vi.fn(),
}));
const findFirstMock = vi.fn();
vi.mock('@tims/db', () => ({
  db: {
    aiAgentOrgConfig: {
      findFirst: (...args: unknown[]) => findFirstMock(...args),
    },
  },
}));

import {
  requireEntitlement,
  hasEntitlement,
} from '../../packages/api/src/services/entitlement.service';
import {
  assertAiInterviewEnabled,
  isAiInterviewEnabled,
} from '../../packages/api/src/services/ai-interview-access.service';

const mockReq = vi.mocked(requireEntitlement);
const mockHas = vi.mocked(hasEntitlement);

// Default: a config row exists with billing params (mirrors a fully-configured org).
const enabledConfig = {
  enabled: true,
  monthlyBudget: null,
  billableUsdPerMinute: 0.15,
  addonMonthlyFeeUsd: null,
  aiInterviewDefaultMaxMinutes: 30,
  aiInterviewMaxMinutesByType: null,
};

describe('assertAiInterviewEnabled via entitlement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findFirstMock.mockResolvedValue(enabledConfig);
  });

  it('passes when the org is entitled', async () => {
    mockReq.mockResolvedValue({ moduleCode: 'ai_voice_interview', limit: null, unitPrice: 0.15 });

    const cfg = await assertAiInterviewEnabled('org1');

    expect(mockReq).toHaveBeenCalledWith('org1', 'ai_voice_interview');
    expect(cfg.billableUsdPerMinute).toBe(0.15);
  });

  it('throws FORBIDDEN when not entitled', async () => {
    mockReq.mockRejectedValue(
      new TRPCError({ code: 'FORBIDDEN', message: 'entitlement_missing:ai_voice_interview' }),
    );

    await expect(assertAiInterviewEnabled('org2')).rejects.toThrow(TRPCError);
  });

  it('does NOT throw when entitled even if aiAgentOrgConfig.enabled is false (config no longer gates)', async () => {
    // Entitled org whose billing-config row is turned off: enablement is decided by the
    // entitlement, not by aiAgentOrgConfig.enabled, so the hard gate must pass.
    mockReq.mockResolvedValue({ moduleCode: 'ai_voice_interview', limit: null, unitPrice: 0.15 });
    findFirstMock.mockResolvedValue({ ...enabledConfig, enabled: false });

    const cfg = await assertAiInterviewEnabled('org3');

    expect(mockReq).toHaveBeenCalledWith('org3', 'ai_voice_interview');
    expect(cfg.billableUsdPerMinute).toBe(0.15);
  });
});

describe('isAiInterviewEnabled (UI visibility) is entitlement-only', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findFirstMock.mockResolvedValue(enabledConfig);
  });

  it('returns true when entitled even if aiAgentOrgConfig.enabled is false', async () => {
    // Reconciled behavior: the UI visibility signal matches the hard gate — it keys off the
    // entitlement alone and ignores aiAgentOrgConfig.enabled (billing param, non-gating).
    mockHas.mockResolvedValue(true);
    findFirstMock.mockResolvedValue({ ...enabledConfig, enabled: false });

    await expect(isAiInterviewEnabled('org3')).resolves.toBe(true);
    expect(mockHas).toHaveBeenCalledWith('org3', 'ai_voice_interview');
  });

  it('returns false when the org is not entitled', async () => {
    mockHas.mockResolvedValue(false);

    await expect(isAiInterviewEnabled('org4')).resolves.toBe(false);
    expect(mockHas).toHaveBeenCalledWith('org4', 'ai_voice_interview');
  });
});
