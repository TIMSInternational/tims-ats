import { ALERT_METRIC_KEYS, type AlertMetricKey, type AlertOperator } from '@tims/shared';
import { logger } from '@tims/shared';
import { alertEvaluationRepository as repo } from '../repositories/alert-evaluation.repository';

// Pure breach decision — value vs threshold under an operator. A null value
// (unknown/uncomputable metric) never fires; an unknown operator fails safe.
export function evaluateCondition(value: number | null, operator: AlertOperator, threshold: number): boolean {
  if (value === null) return false;
  switch (operator) {
    case 'gt':
      return value > threshold;
    case 'gte':
      return value >= threshold;
    case 'lt':
      return value < threshold;
    case 'lte':
      return value <= threshold;
    case 'eq':
      return value === threshold;
    default:
      return false;
  }
}

interface RuleCondition {
  metric: AlertMetricKey;
  operator: AlertOperator;
  threshold: number;
}

// Narrow the persisted `condition` Json into a typed, validated shape. Returns
// null (skip) if the stored metric/operator are not in the known registry.
function parseCondition(condition: unknown): RuleCondition | null {
  if (typeof condition !== 'object' || condition === null) return null;
  const c = condition as Record<string, unknown>;
  const metric = c.metric;
  const operator = c.operator;
  const threshold = c.threshold;
  if (typeof metric !== 'string' || !ALERT_METRIC_KEYS.includes(metric as AlertMetricKey)) return null;
  if (typeof operator !== 'string' || !['gt', 'lt', 'eq', 'gte', 'lte'].includes(operator)) return null;
  if (typeof threshold !== 'number' || Number.isNaN(threshold)) return null;
  return { metric: metric as AlertMetricKey, operator: operator as AlertOperator, threshold };
}

export interface AlertEvaluationSummary {
  rules: number;
  fired: number;
  skipped: number;
}

// Evaluate every active alert rule across all orgs and fire (dedup'd) alerts for
// breaches. Designed to be invoked by the Vercel cron route. One slow/failed rule
// must not abort the batch — failures are logged and counted as skipped.
export async function evaluateAlertRules(): Promise<AlertEvaluationSummary> {
  const rules = await repo.listActiveRules();
  let fired = 0;
  let skipped = 0;

  for (const rule of rules) {
    try {
      const cond = parseCondition(rule.condition);
      if (!cond) {
        skipped++;
        continue;
      }
      // An uncomputable metric must NEVER be a silent no-op. Before this branch the
      // engine took `computeMetric`'s `null` and fell straight through
      // `evaluateCondition(null, …) === false` into a plain `continue` OUTSIDE the
      // catch below — so a rule whose metric had lost its handler stopped firing
      // forever while the run still reported `{ fired: 0, skipped: 0 }`, which is
      // indistinguishable from a healthy platform with no breaches.
      const outcome = await repo.computeMetricOutcome(rule.organizationId, cond.metric);
      if (outcome.kind === 'unavailable') {
        skipped++;
        logger.error(
          { ruleId: rule.id, orgId: rule.organizationId, metric: cond.metric, reason: outcome.reason },
          'alert-evaluation: metric could not be computed — rule NOT evaluated',
        );
        continue;
      }
      // A §21 min-5 suppression is a DESIGNED outcome, not a failure: it is neither
      // logged nor counted, because either would disclose that this org holds a
      // sub-floor count over a restricted model (the oracle the guard closes).
      if (outcome.kind === 'suppressed') continue;

      const value = outcome.value;
      if (!evaluateCondition(value, cond.operator, cond.threshold)) continue;

      // Breach: only create an alert if this rule has no open one already.
      if (await repo.hasActiveAlertForRule(rule.id, rule.organizationId)) continue;

      await repo.createAlert({
        organizationId: rule.organizationId,
        ruleId: rule.id,
        module: rule.module,
        severity: rule.severity,
        title: cond.metric,
        message: rule.message,
        metadata: { metric: cond.metric, operator: cond.operator, threshold: cond.threshold, value },
      });
      fired++;
    } catch (err) {
      skipped++;
      logger.error({ err, ruleId: rule.id, orgId: rule.organizationId }, 'alert-evaluation: rule failed');
    }
  }

  logger.info({ rules: rules.length, fired, skipped }, 'alert-evaluation: complete');
  return { rules: rules.length, fired, skipped };
}
