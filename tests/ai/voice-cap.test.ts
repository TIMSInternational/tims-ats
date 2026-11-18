import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TRPCError } from '@trpc/server';

// The voice-interview monthly cap (packages/ai/src/voice-cap.ts): meter-and-bill by default,
// a hard refusal only when AI_VOICE_HARD_CAP_ENABLED is exactly 'true'.

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  aggregate: vi.fn(),
  runWithTenant: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@tims/db', () => ({
  tenantDb: {
    aiAgentOrgConfig: { findFirst: (...a: unknown[]) => mocks.findFirst(...a) },
    aiAgentUsageLog: { aggregate: (...a: unknown[]) => mocks.aggregate(...a) },
  },
  runWithTenant: (orgId: string, fn: () => unknown) => mocks.runWithTenant(orgId, fn),
}));
vi.mock('@tims/shared', () => ({ logger: { warn: mocks.warn, info: vi.fn(), error: vi.fn() } }));

import {
  AI_VOICE_CAP_REACHED,
  AI_VOICE_HARD_CAP_ENV,
  VOICE_CAP_DEFAULT_MONTHLY_USD,
  assertVoiceSessionWithinCap,
  checkVoiceSessionCap,
  evaluateVoiceCap,
  isVoiceHardCapEnabled,
} from '../../packages/ai/src/voice-cap';

const ORG = '00000000-0000-0000-0000-0000000000b2';
const NOW = new Date(2026, 10, 18, 15, 30); // 18 Nov 2026, local time

function spend(costUsd: number | null, monthlyBudget?: number | null) {
  mocks.aggregate.mockResolvedValue({ _sum: { costUsd } });
  mocks.findFirst.mockResolvedValue(monthlyBudget === undefined ? null : { monthlyBudget });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env[AI_VOICE_HARD_CAP_ENV];
  mocks.runWithTenant.mockImplementation((_orgId: string, fn: () => unknown) => fn());
});

afterEach(() => {
  delete process.env[AI_VOICE_HARD_CAP_ENV];
});

describe('isVoiceHardCapEnabled — opt-in, exact "true" only', () => {
  it.each([
    [undefined, false],
    ['', false],
    ['false', false],
    ['TRUE', false],
    ['1', false],
    ['true', true],
  ])('%j → %s', (value, expected) => {
    expect(isVoiceHardCapEnabled(value)).toBe(expected);
  });
});

describe('evaluateVoiceCap — pure decision', () => {
  it('uses the configured budget, else the 25 USD default', () => {
    expect(evaluateVoiceCap(10, 50, false).capUsd).toBe(50);
    expect(evaluateVoiceCap(10, null, false).capUsd).toBe(VOICE_CAP_DEFAULT_MONTHLY_USD);
    expect(evaluateVoiceCap(10, undefined, false).capUsd).toBe(25);
  });

  it('treats a negative or non-finite budget as unset', () => {
    expect(evaluateVoiceCap(1, -5, false).capUsd).toBe(25);
    expect(evaluateVoiceCap(1, Number.NaN, false).capUsd).toBe(25);
  });

  it('is over the cap at exactly the cap (spent >= cap), and a 0 budget means no voice', () => {
    expect(evaluateVoiceCap(24.99, 25, true).overCap).toBe(false);
    expect(evaluateVoiceCap(25, 25, true).overCap).toBe(true);
    expect(evaluateVoiceCap(0, 0, true).overCap).toBe(true);
  });
});

describe('checkVoiceSessionCap — tenant-scoped reads', () => {
  it('reads this calendar month of the voice agent for this org only, inside runWithTenant', async () => {
    spend(3, 40);
    const status = await checkVoiceSessionCap(ORG, NOW);
    expect(status).toEqual({ capUsd: 40, spentUsd: 3, overCap: false, enforced: false });
    expect(mocks.runWithTenant).toHaveBeenCalledWith(ORG, expect.any(Function));
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { organizationId: ORG, agent: { slug: 'ai-voice-interview' } },
      select: { monthlyBudget: true },
    });
    expect(mocks.aggregate).toHaveBeenCalledWith({
      where: {
        organizationId: ORG,
        agent: { slug: 'ai-voice-interview' },
        createdAt: { gte: new Date(2026, 10, 1) },
      },
      _sum: { costUsd: true },
    });
  });

  it('no usage yet counts as 0 spent', async () => {
    spend(null);
    expect((await checkVoiceSessionCap(ORG, NOW)).spentUsd).toBe(0);
  });
});

describe('assertVoiceSessionWithinCap — the gate for a NEW session', () => {
  it('under the cap: proceeds silently, whatever the flag', async () => {
    process.env[AI_VOICE_HARD_CAP_ENV] = 'true';
    spend(5, 25);
    await expect(assertVoiceSessionWithinCap(ORG, NOW)).resolves.toMatchObject({ overCap: false });
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it('over the cap with enforcement OFF (default): proceeds and logs a warning (meter-and-bill)', async () => {
    spend(30, 25);
    await expect(assertVoiceSessionWithinCap(ORG, NOW)).resolves.toMatchObject({ overCap: true, enforced: false });
    expect(mocks.warn).toHaveBeenCalledTimes(1);
    expect(mocks.warn.mock.calls[0]?.[0]).toMatchObject({ organizationId: ORG, enforced: false, monthlyCapUsd: 25 });
  });

  it('over the cap with enforcement ON: refuses with TOO_MANY_REQUESTS ai_voice_cap_reached', async () => {
    process.env[AI_VOICE_HARD_CAP_ENV] = 'true';
    spend(25, 25);
    const error = await assertVoiceSessionWithinCap(ORG, NOW).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TRPCError);
    expect(error).toMatchObject({ code: 'TOO_MANY_REQUESTS', message: AI_VOICE_CAP_REACHED });
    expect(mocks.warn).toHaveBeenCalledTimes(1);
  });

  it('a non-exact flag value does not enforce', async () => {
    process.env[AI_VOICE_HARD_CAP_ENV] = 'TRUE';
    spend(100, 25);
    await expect(assertVoiceSessionWithinCap(ORG, NOW)).resolves.toMatchObject({ overCap: true, enforced: false });
  });
});
