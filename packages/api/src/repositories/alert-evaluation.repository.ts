import { db } from '@tims/db';
import type { AlertMetricKey } from '@tims/shared';
import { suppressBelowMin5 } from '../access';
import { platformGetWithHeaders } from '../lib/platform-api-client';

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

/**
 * Is this metric computed over one of the four §21-restricted models? Exported so the cross-stack
 * golden (contracts/alert-metrics-fixtures/cases.json) asserts THIS predicate — the one the live path
 * below actually calls — rather than a copy of the set that could drift from it.
 */
export function isSensitiveAlertMetric(metric: AlertMetricKey): boolean {
  return SENSITIVE_ALERT_METRICS.has(metric);
}

/**
 * The §21 min-5 floor for one metric value. Extracted from `computeMetric` so it is directly testable,
 * and so the C# port (`Tims.Domain.AlertMetrics.AlertMetricKeys` + `KAnonymity.SuppressBelowMin5`) can
 * be pinned to the SAME golden. 1..4 over a restricted model becomes null — `evaluateCondition(null, …)`
 * returns false, so the rule cannot fire as an oracle AND no sub-floor value is persisted into the
 * alert's metadata. 0 and >=5 pass through; NON-sensitive metrics are never floored.
 *
 * Idempotent by construction, which is what makes it safe to apply on top of the identical floor the C#
 * surface already applied server-side: a null never re-enters it, and 0/>=5 map to themselves.
 */
export function applyAlertMetricFloor(metric: AlertMetricKey, value: number | null): number | null {
  if (value === null || !isSensitiveAlertMetric(metric)) return value;
  return suppressBelowMin5(value).count;
}

// ── The C#-served subset (§8 Q0b slice 2, issue #172) ────────────────────────
// The two metrics whose tables move to EF Core ownership: `surveys` (flip #64) and
// `salary_adjustments` (flip #66). Once those flips land the Prisma models STOP EXISTING, so these two
// reads must come from the C# platform service. Every other metric counts a table that does not flip
// and stays on the Prisma path permanently.
export const ALERT_METRICS_VIA_CSHARP: readonly AlertMetricKey[] = ['active_surveys', 'pending_salary_adjustments'];

/**
 * Route the two flip-blocked metrics to the C# surface? Server-only (the cron runs on the server) and
 * deliberately NOT `NEXT_PUBLIC_*` — this credential-bearing path must never be inlined into a client
 * bundle. Exact "true" only, mirroring RLS_ENFORCED / MFA_ENFORCED.
 *
 * OFF is today's behaviour, unchanged: Prisma serves everything. That IS the reversibility mechanism —
 * set the env var back and the Prisma path below resumes, with no code change.
 */
function isAlertMetricsViaCSharp(): boolean {
  return process.env.ALERT_METRICS_READ_VIA_CSHARP === 'true';
}

interface AlertMetricWireResponse {
  status: unknown;
  value: unknown;
}

/**
 * Fetch one metric for one org from the C# cross-org surface.
 *
 * FAILS LOUD. Every error path throws rather than returning a number, because the caller
 * (`evaluateAlertRules`) treats a thrown rule as `skipped` and logs it, whereas a returned `0` is
 * indistinguishable from "no breach". A metric silently pinned at 0 means alerts stop firing for every
 * org with nobody noticing — so a fallback that looks helpful here is the bug, not the safety net.
 *
 * The response is validated field by field rather than cast: `value` is `number | null` on the wire, and
 * TypeScript will not catch a bare coercion collapsing that into 0.
 */
async function fetchMetricFromCSharp(orgId: string, metric: AlertMetricKey): Promise<number | null> {
  const secret = process.env.ALERT_METRICS_CRON_SECRET;
  if (!secret) {
    throw new Error(`alert-metrics: ALERT_METRICS_CRON_SECRET is unset (metric=${metric})`);
  }

  const { status, body } = await platformGetWithHeaders(
    '/internal/alert-metrics',
    { 'X-Tims-Cron-Secret': secret },
    { organizationId: orgId, metric },
  );

  if (status !== 200) {
    throw new Error(`alert-metrics: platform service returned ${status} (metric=${metric})`);
  }

  if (body === null || typeof body !== 'object') {
    throw new Error(`alert-metrics: unparseable body (metric=${metric})`);
  }

  const wire = body as AlertMetricWireResponse;
  switch (wire.status) {
    case 'value':
      if (typeof wire.value !== 'number' || !Number.isInteger(wire.value)) {
        throw new Error(`alert-metrics: status=value with a non-integer value (metric=${metric})`);
      }
      return wire.value;
    case 'suppressed':
      // The §21 floor already fired server-side. null is the correct, non-firing value — NOT an error.
      return null;
    case 'unavailable':
      throw new Error(`alert-metrics: platform reported unavailable (metric=${metric})`);
    default:
      throw new Error(`alert-metrics: unknown status ${String(wire.status)} (metric=${metric})`);
  }
}

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
    const value = await this.computeRawMetric(orgId, metric);
    // 1..4 over a restricted model → null (no oracle, nothing persisted); 0 and >=5 pass through.
    // Applied unconditionally, including to values the C# surface already floored: the floor is
    // idempotent, and keeping it here means the guard survives even if the remote side ever stops
    // applying it. The oracle guard must not be something a remote service can switch off.
    return applyAlertMetricFloor(metric, value);
  },

  async computeRawMetric(orgId: string, metric: AlertMetricKey): Promise<number | null> {
    // §8 Q0b slice 2 (#172): the two flip-blocked metrics route to C# when the flag is on. This is
    // BEFORE the switch so the Prisma cases below stay untouched and remain the exact fallback the
    // flag reverts to — and so that after flips #64/#66 delete those Prisma models, the only live
    // path for these two is the one that still has tables behind it.
    if (isAlertMetricsViaCSharp() && ALERT_METRICS_VIA_CSHARP.includes(metric)) {
      return fetchMetricFromCSharp(orgId, metric);
    }

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
