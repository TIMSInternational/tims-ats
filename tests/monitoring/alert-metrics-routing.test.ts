import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * #172 — WHERE the two flip-blocked metrics are read from, and what happens when that read fails.
 *
 * The flag is the reversibility mechanism for flips #64/#66: off ⇒ Prisma (today, unchanged), on ⇒ the
 * C# cross-org surface. The failure semantics are the part worth pinning hardest. `evaluateAlertRules`
 * treats a THROWN rule as `skipped` and logs it, but a RETURNED `0` is indistinguishable from "no
 * breach" — so a helpful-looking fallback that swallows a platform outage and returns 0 would silently
 * stop alerting for every organization, which is precisely the defect class this slice exists to close.
 */

const salaryAdjustmentCount = vi.fn();
const surveyCount = vi.fn();
const userCount = vi.fn();

vi.mock('@tims/db', () => ({
  db: {
    salaryAdjustment: { count: (...a: unknown[]) => salaryAdjustmentCount(...a) },
    survey: { count: (...a: unknown[]) => surveyCount(...a) },
    user: { count: (...a: unknown[]) => userCount(...a) },
    vacancy: { count: vi.fn() },
    alert: { count: vi.fn() },
    alertRule: { findMany: vi.fn() },
    application: { findMany: vi.fn() },
  },
}));

const platformGet = vi.fn();
vi.mock('../../packages/api/src/lib/platform-api-client', () => ({
  platformGetWithHeaders: (...a: unknown[]) => platformGet(...a),
  isPlatformApiEnabled: () => true,
}));

const { alertEvaluationRepository: repo } =
  await import('../../packages/api/src/repositories/alert-evaluation.repository');

const ORG = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.ALERT_METRICS_READ_VIA_CSHARP;
  process.env.ALERT_METRICS_CRON_SECRET = 'test-secret';
});

afterEach(() => {
  delete process.env.ALERT_METRICS_READ_VIA_CSHARP;
  delete process.env.ALERT_METRICS_CRON_SECRET;
});

describe('alert-metrics routing — flag OFF (today, and the state the flag reverts to)', () => {
  it('reads pending_salary_adjustments from Prisma and never calls the platform service', async () => {
    salaryAdjustmentCount.mockResolvedValue(9);

    await expect(repo.computeMetric(ORG, 'pending_salary_adjustments')).resolves.toBe(9);
    expect(platformGet).not.toHaveBeenCalled();
  });

  it('reads active_surveys from Prisma and never calls the platform service', async () => {
    surveyCount.mockResolvedValue(4);

    await expect(repo.computeMetric(ORG, 'active_surveys')).resolves.toBe(4);
    expect(platformGet).not.toHaveBeenCalled();
  });

  it('still applies the §21 floor on the Prisma path', async () => {
    salaryAdjustmentCount.mockResolvedValue(3);

    await expect(repo.computeMetric(ORG, 'pending_salary_adjustments')).resolves.toBeNull();
  });

  it('a value other than the exact string "true" does not enable the C# path', async () => {
    // Mirrors RLS_ENFORCED / MFA_ENFORCED: exact match only, so a garbled value fails to the safe side.
    for (const value of ['TRUE', '1', 'yes', 'true ', '']) {
      process.env.ALERT_METRICS_READ_VIA_CSHARP = value;
      surveyCount.mockResolvedValue(2);

      await expect(repo.computeMetric(ORG, 'active_surveys')).resolves.toBe(2);
      expect(platformGet).not.toHaveBeenCalled();
    }
  });
});

describe('alert-metrics routing — flag ON', () => {
  beforeEach(() => {
    process.env.ALERT_METRICS_READ_VIA_CSHARP = 'true';
  });

  it('routes the two flip-blocked metrics to C# and stops touching Prisma for them', async () => {
    platformGet.mockResolvedValue({ status: 200, body: { status: 'value', value: 12 } });

    await expect(repo.computeMetric(ORG, 'active_surveys')).resolves.toBe(12);
    expect(surveyCount).not.toHaveBeenCalled();

    const [path, headers, query] = platformGet.mock.calls[0];
    expect(path).toBe('/internal/alert-metrics');
    expect(headers).toEqual({ 'X-Tims-Cron-Secret': 'test-secret' });
    expect(query).toEqual({ organizationId: ORG, metric: 'active_surveys' });
  });

  it('does NOT route metrics whose tables never flip — headcount stays on Prisma', async () => {
    userCount.mockResolvedValue(50);

    await expect(repo.computeMetric(ORG, 'headcount')).resolves.toBe(50);
    expect(platformGet).not.toHaveBeenCalled();
  });

  it('maps a server-side suppression to null (non-firing), not to an error and not to 0', async () => {
    platformGet.mockResolvedValue({ status: 200, body: { status: 'suppressed', value: null } });

    await expect(repo.computeMetric(ORG, 'pending_salary_adjustments')).resolves.toBeNull();
  });

  it('re-applies the floor locally, so the guard survives a remote side that stops flooring', async () => {
    // If the C# surface ever returned a raw sub-floor count for the sensitive metric, the oracle guard
    // must still hold on this side. The remote service must not be able to switch off a §21 control.
    platformGet.mockResolvedValue({ status: 200, body: { status: 'value', value: 3 } });

    await expect(repo.computeMetric(ORG, 'pending_salary_adjustments')).resolves.toBeNull();
  });

  it('passes a legitimate at-floor value through unchanged', async () => {
    platformGet.mockResolvedValue({ status: 200, body: { status: 'value', value: 5 } });

    await expect(repo.computeMetric(ORG, 'pending_salary_adjustments')).resolves.toBe(5);
  });

  // ── Fail-loud. Every row here must THROW; none may resolve to a number. ──
  const failures: Array<[string, unknown]> = [
    ['a 500 from the platform service', { status: 500, body: null }],
    ['a 401 — the cron secret is wrong or unset on the server', { status: 401, body: null }],
    ['a 404 — the surface is dark (flag off on the C# side)', { status: 404, body: null }],
    ['an explicit unavailable outcome', { status: 200, body: { status: 'unavailable', reason: 'no_handler' } }],
    ['an unknown status literal', { status: 200, body: { status: 'weird', value: 1 } }],
    ['a null body', { status: 200, body: null }],
    ['status=value with a null value', { status: 200, body: { status: 'value', value: null } }],
    ['status=value with a missing value', { status: 200, body: { status: 'value' } }],
    ['status=value with a string value', { status: 200, body: { status: 'value', value: '7' } }],
    ['status=value with a non-integer value', { status: 200, body: { status: 'value', value: 1.5 } }],
  ];

  for (const [name, response] of failures) {
    it(`throws (never returns 0) on: ${name}`, async () => {
      platformGet.mockResolvedValue(response);

      await expect(repo.computeMetric(ORG, 'active_surveys')).rejects.toThrow();
    });
  }

  it('throws when the cron secret is not configured, instead of calling unauthenticated', async () => {
    delete process.env.ALERT_METRICS_CRON_SECRET;

    await expect(repo.computeMetric(ORG, 'active_surveys')).rejects.toThrow(/ALERT_METRICS_CRON_SECRET/);
    expect(platformGet).not.toHaveBeenCalled();
  });

  it('propagates a transport error rather than falling back to Prisma', async () => {
    // A silent Prisma fallback would mask a broken cutover during canary AND would be impossible after
    // the flip, when the Prisma models no longer exist. Reversal is the flag's job, not a catch block's.
    platformGet.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(repo.computeMetric(ORG, 'active_surveys')).rejects.toThrow('ECONNREFUSED');
    expect(surveyCount).not.toHaveBeenCalled();
  });
});
