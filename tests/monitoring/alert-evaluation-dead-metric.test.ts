import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Dead-metric observability (Q0b slice 2) ─────────────────────────────────
// INVARIANT under test: an alert rule whose metric cannot be COMPUTED (no handler,
// or the handler's data has moved to a surface that is currently unreachable — e.g.
// a flipped table behind a dark C# read flag) must be OBSERVABLE: it must increment
// the `skipped` counter and emit a log line. A rule that can never fire again while
// the cron reports `{ fired: 0, skipped: 0 }` is indistinguishable from a healthy
// platform with no breaches.
//
// This is deliberately NOT a test of "the current code silently continues" — that
// would pin the defect. It pins the invariant the fix must satisfy.

const alertRuleFindMany = vi.fn();
const alertFindFirst = vi.fn();
const alertCreate = vi.fn();

vi.mock('@tims/db', () => ({
  db: {
    alertRule: { findMany: (...a: unknown[]) => alertRuleFindMany(...a) },
    alert: {
      findFirst: (...a: unknown[]) => alertFindFirst(...a),
      create: (...a: unknown[]) => alertCreate(...a),
      count: vi.fn(),
    },
    salaryAdjustment: { count: vi.fn() },
    vacancy: { count: vi.fn() },
    user: { count: vi.fn() },
    survey: { count: vi.fn() },
    application: { findMany: vi.fn() },
  },
}));

const loggerError = vi.fn();
const loggerInfo = vi.fn();
const loggerWarn = vi.fn();

vi.mock('@tims/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tims/shared')>();
  return {
    ...actual,
    logger: {
      error: (...a: unknown[]) => loggerError(...a),
      info: (...a: unknown[]) => loggerInfo(...a),
      warn: (...a: unknown[]) => loggerWarn(...a),
      debug: vi.fn(),
    },
  };
});

const ORG = '00000000-0000-0000-0000-0000000000a1';

describe('alert-evaluation: an uncomputable metric must be observable', () => {
  let evaluateAlertRules: () => Promise<{ rules: number; fired: number; skipped: number }>;
  let repo: typeof import('../../packages/api/src/repositories/alert-evaluation.repository').alertEvaluationRepository;

  beforeEach(async () => {
    vi.clearAllMocks();
    const repoMod = await import('../../packages/api/src/repositories/alert-evaluation.repository');
    repo = repoMod.alertEvaluationRepository;
    const svcMod = await import('../../packages/api/src/services/alert-evaluation.service');
    evaluateAlertRules = svcMod.evaluateAlertRules;

    alertRuleFindMany.mockResolvedValue([
      {
        id: 'rule-1',
        organizationId: ORG,
        module: 'engagement',
        condition: { metric: 'active_surveys', operator: 'gt', threshold: 0 },
        severity: 'high',
        message: 'too many surveys',
      },
    ]);
    alertFindFirst.mockResolvedValue(null);
    alertCreate.mockResolvedValue({ id: 'alert-1' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a metric with NO handler increments `skipped` and logs (never a silent no-op)', async () => {
    // Simulate exactly what the runbook warns about: the `case 'active_surveys'`
    // is gone from the metric switch (the table flipped to C#), so the raw
    // computation has no handler for it.
    vi.spyOn(repo, 'computeMetricOutcome').mockResolvedValue({
      kind: 'unavailable',
      reason: 'no_handler',
    });

    const summary = await evaluateAlertRules();

    expect(summary.fired).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(loggerError).toHaveBeenCalled();
  });

  it('the log line identifies WHICH rule/org/metric died (an anonymous line is not actionable)', async () => {
    vi.spyOn(repo, 'computeMetricOutcome').mockResolvedValue({
      kind: 'unavailable',
      reason: 'no_handler',
    });

    await evaluateAlertRules();

    expect(loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        ruleId: 'rule-1',
        orgId: ORG,
        metric: 'active_surveys',
        reason: 'no_handler',
      }),
      expect.any(String),
    );
  });

  it('a DELIBERATE sub-floor suppression is NOT logged and NOT counted as a failure', async () => {
    // The §21 min-5 oracle guard is a designed outcome, not a defect: logging it
    // (or surfacing it in a counter) would itself disclose that this org has a
    // sub-floor count over a restricted model.
    vi.spyOn(repo, 'computeMetricOutcome').mockResolvedValue({ kind: 'suppressed' });

    const summary = await evaluateAlertRules();

    expect(summary.fired).toBe(0);
    expect(summary.skipped).toBe(0);
    expect(loggerError).not.toHaveBeenCalled();
  });

  it('a computable metric still fires normally', async () => {
    vi.spyOn(repo, 'computeMetricOutcome').mockResolvedValue({ kind: 'value', value: 9 });

    const summary = await evaluateAlertRules();

    expect(summary.fired).toBe(1);
    expect(summary.skipped).toBe(0);
    expect(alertCreate).toHaveBeenCalled();
  });
});
