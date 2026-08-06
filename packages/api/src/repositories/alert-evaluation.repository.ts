import { db } from '@tims/db';
import type { AlertMetricKey } from '@tims/shared';
import { suppressBelowMin5 } from '../access';

// Data access for the cron alert-evaluation engine. Runs in a cron context (no
// per-request tenant), so it uses the privileged `db` and scopes EVERY query by
// an explicit organizationId — mirroring the platform routers. Every metric here
// maps to real data (see ALERT_METRIC_KEYS in @tims/shared).

const MS_PER_HOUR = 3_600_000;
const SIXTY_DAYS_MS = 60 * 24 * MS_PER_HOUR;

// ── Sensitive-metric oracle guard (slice 6 round 8) ─────────────────────────
// An alert RULE is an exact-count oracle: a monitoring updater can configure a
// rule `metric eq 3` (or lt/lte) and observe whether an alert fires, recovering a
// sub-floor count over a §21-restricted population WITHOUT ever calling a read
// endpoint. So for metrics computed OVER one of the four restricted models
// (employeeCompensation / employeeDemographics / surveyResponse / salaryAdjustment),
// a value in 1..4 is itself a sub-floor disclosure — we floor it to `null` here so
// `evaluateCondition(null, …)` returns false (the rule cannot fire as an oracle)
// AND no sub-floor value is persisted into the fired alert's metadata. 0 and >=5
// pass through unchanged. NON-sensitive metrics (headcount, vacancy/alert counts,
// SLA breaches — none over the four models) are unaffected and evaluate normally.
//
// Of the current ALERT_METRIC_KEYS, only `pending_salary_adjustments` counts a
// restricted model (SalaryAdjustment). `active_surveys` counts Survey definitions
// (not surveyResponse), `headcount`/`active_alerts`/`vacancies_open_60d`/
// `sla_active_breaches` are non-sensitive. The set is keyed off the metric, so any
// future metric added over one of the four models must be listed here.
const SENSITIVE_ALERT_METRICS: ReadonlySet<AlertMetricKey> = new Set<AlertMetricKey>(['pending_salary_adjustments']);

// ── Metric outcome (Q0b slice 2) ────────────────────────────────────────────
// `computeMetric` used to collapse THREE different situations into one `null`:
//   1. the metric was computed and its value is genuinely unusable (never happens —
//      a count is always a number),
//   2. the §21 min-5 oracle guard DELIBERATELY floored a sub-floor 1..4 value,
//   3. the metric has NO handler at all (the `default:` arm) — i.e. the rule can
//      never be evaluated again.
// The service could not tell (2) from (3), so (3) was a permanent silent no-op: no
// exception, no log, no `skipped` increment (proven against the pre-fix code before
// this change; see tests/monitoring/alert-evaluation-dead-metric.test.ts). This
// discriminated union is the fix — the CALLER decides what each outcome means.
export type AlertMetricOutcome =
  // The metric was computed. `value` is safe to compare against a threshold.
  | { kind: 'value'; value: number }
  // Deliberate §21 min-5 suppression. NOT an error and NOT logged: emitting a log
  // line or a counter for it would itself disclose that this org holds a sub-floor
  // count over a restricted model — the exact oracle the guard exists to close.
  | { kind: 'suppressed' }
  // The metric could not be computed at all. ALWAYS a defect or a mid-flip state
  // (handler removed, or the data moved to a surface that is currently unreachable).
  // The caller MUST make this visible — that is the whole point of this union.
  | { kind: 'unavailable'; reason: 'no_handler' };

export const alertEvaluationRepository = {
  // All active rules across all orgs (the cron evaluates the whole platform).
  listActiveRules() {
    return db.alertRule.findMany({
      where: { isActive: true },
      select: {
        id: true,
        organizationId: true,
        module: true,
        condition: true,
        severity: true,
        message: true,
      },
    });
  },

  // True if this rule already has an unresolved (active) alert — so a persistent
  // breach doesn't spawn a duplicate alert on every cron run. Scoped by org as
  // defense-in-depth even though ruleId is globally unique.
  async hasActiveAlertForRule(ruleId: string, orgId: string): Promise<boolean> {
    const existing = await db.alert.findFirst({
      where: { ruleId, organizationId: orgId, status: 'active' },
      select: { id: true },
    });
    return existing !== null;
  },

  createAlert(data: {
    organizationId: string;
    ruleId: string;
    module: string;
    severity: string;
    title: string;
    message: string;
    metadata: Record<string, unknown>;
  }) {
    return db.alert.create({
      data: {
        organizationId: data.organizationId,
        ruleId: data.ruleId,
        module: data.module,
        severity: data.severity,
        title: data.title,
        message: data.message,
        metadata: data.metadata as object,
        status: 'active',
      },
      select: { id: true },
    });
  },

  // Compute the current value of a metric for one org. Returns null for an
  // unrecognized key so the engine skips (rather than fires) the rule. For a
  // SENSITIVE metric (over a §21-restricted model) a sub-floor 1..4 value is also
  // floored to null so a rule cannot be used as an exact-count oracle (see
  // SENSITIVE_ALERT_METRICS above): a null value never fires and is never persisted.
  async computeMetric(orgId: string, metric: AlertMetricKey): Promise<number | null> {
    const outcome = await this.computeMetricOutcome(orgId, metric);
    return outcome.kind === 'value' ? outcome.value : null;
  },

  // The outcome-typed form of `computeMetric` — see AlertMetricOutcome. This is what
  // the evaluation engine calls, because it is the only form that can distinguish a
  // deliberate suppression from a metric that has no handler at all.
  async computeMetricOutcome(orgId: string, metric: AlertMetricKey): Promise<AlertMetricOutcome> {
    const raw = await this.computeRawMetric(orgId, metric);
    if (raw === null) {
      return { kind: 'unavailable', reason: 'no_handler' };
    }
    if (SENSITIVE_ALERT_METRICS.has(metric)) {
      // 1..4 → suppressed (no oracle, nothing persisted); 0 and >=5 pass through.
      const suppressed = suppressBelowMin5(raw).count;
      return suppressed === null ? { kind: 'suppressed' } : { kind: 'value', value: suppressed };
    }
    return { kind: 'value', value: raw };
  },

  async computeRawMetric(orgId: string, metric: AlertMetricKey): Promise<number | null> {
    switch (metric) {
      case 'vacancies_open_60d':
        return db.vacancy.count({
          where: {
            organizationId: orgId,
            status: 'open',
            deletedAt: null,
            createdAt: { lte: new Date(Date.now() - SIXTY_DAYS_MS) },
          },
        });

      case 'sla_active_breaches':
        return this.slaActiveBreaches(orgId);

      case 'pending_salary_adjustments':
        return db.salaryAdjustment.count({
          where: { organizationId: orgId, status: 'pending' },
        });

      case 'active_surveys':
        return db.survey.count({ where: { organizationId: orgId, status: 'active' } });

      case 'headcount':
        return db.user.count({ where: { organizationId: orgId, isActive: true } });

      case 'active_alerts':
        return db.alert.count({ where: { organizationId: orgId, status: 'active' } });

      default:
        return null;
    }
  },

  // Active applications whose time in their current stage exceeds that stage's
  // SLA. Mirrors recruitment-analytics' hoursInStage logic; bounded sample.
  // SCALING NOTE: this loads up to 10k apps PER ORG into memory each cron run and
  // counts breaches in app code. Fine at current scale; if org app-counts grow,
  // promote this to a single DB-side COUNT ($queryRaw comparing now vs
  // movedAt/appliedAt + slaHours) per the "build for the trigger" rule.
  async slaActiveBreaches(orgId: string): Promise<number> {
    const apps = await db.application.findMany({
      where: { organizationId: orgId, status: 'active' },
      select: {
        appliedAt: true,
        currentStage: { select: { slaHours: true } },
        movements: { orderBy: { movedAt: 'desc' }, take: 1, select: { movedAt: true } },
      },
      take: 10_000,
    });
    const now = Date.now();
    let breached = 0;
    for (const app of apps) {
      const sla = app.currentStage?.slaHours;
      if (sla == null) continue;
      const since = app.movements[0]?.movedAt ?? app.appliedAt;
      const hours = (now - since.getTime()) / MS_PER_HOUR;
      if (hours > sla) breached++;
    }
    return breached;
  },
};
