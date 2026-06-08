import { db } from '@tims/db';
import type { AlertMetricKey } from '@tims/shared';

// Data access for the cron alert-evaluation engine. Runs in a cron context (no
// per-request tenant), so it uses the privileged `db` and scopes EVERY query by
// an explicit organizationId — mirroring the platform routers. Every metric here
// maps to real data (see ALERT_METRIC_KEYS in @tims/shared).

const MS_PER_HOUR = 3_600_000;
const SIXTY_DAYS_MS = 60 * 24 * MS_PER_HOUR;

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
  // unrecognized key so the engine skips (rather than fires) the rule.
  async computeMetric(orgId: string, metric: AlertMetricKey): Promise<number | null> {
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
