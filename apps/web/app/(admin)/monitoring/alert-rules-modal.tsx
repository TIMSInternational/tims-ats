'use client';

import { useEffect, useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ALERT_METRIC_KEYS,
  ALERT_METRIC_MODULE,
  ALERT_OPERATORS,
  type AlertMetricKey,
  type AlertOperator,
} from '@tims/shared';
import { trpc } from '../../../lib/trpc';
import { useMonitoringAlertRules, invalidateMonitoringPlatformReads } from '../../../lib/platform-api/monitoring';
import { toast } from '../../../lib/toast';
import { useI18n } from '../../../lib/i18n';
import { Modal } from '../../../components/modal';
import { ErrorState, Skeleton } from '../../../components';
import { Button } from '../../../components/button';
import { BUTTON_GROUP_CLASSES } from '../../../components/button-styles';
import { Field } from '../../../components/field';
import {
  CHOICE_INPUT_CLASSES,
  CHOICE_ROW_CLASSES,
  inputClasses,
  selectClasses,
} from '../../../components/field-styles';

type Severity = 'info' | 'warning' | 'critical';

interface EditableRule {
  id?: string;
  metric: AlertMetricKey;
  operator: AlertOperator;
  threshold: number;
  severity: Severity;
  message: string;
  isActive: boolean;
}

const OPERATOR_SYMBOL: Record<AlertOperator, string> = {
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  eq: '=',
};

function newRule(): EditableRule {
  return {
    metric: ALERT_METRIC_KEYS[0],
    operator: 'gt',
    threshold: 0,
    severity: 'warning',
    message: '',
    isActive: true,
  };
}

// Narrow a persisted rule (condition is Json) into an editable row.
function toEditable(rule: {
  id: string;
  condition: unknown;
  severity: string;
  message: string;
  isActive: boolean;
}): EditableRule {
  const c = (rule.condition ?? {}) as Record<string, unknown>;
  const metric = ALERT_METRIC_KEYS.includes(c.metric as AlertMetricKey)
    ? (c.metric as AlertMetricKey)
    : ALERT_METRIC_KEYS[0];
  const operator = (ALERT_OPERATORS as readonly string[]).includes(c.operator as string)
    ? (c.operator as AlertOperator)
    : 'gt';
  return {
    id: rule.id,
    metric,
    operator,
    threshold: typeof c.threshold === 'number' ? c.threshold : 0,
    severity: (['info', 'warning', 'critical'].includes(rule.severity) ? rule.severity : 'warning') as Severity,
    message: rule.message,
    isActive: rule.isActive,
  };
}

export function AlertRulesModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const ar = t.alertRules as Record<string, string>;
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();
  const rulesQuery = useMonitoringAlertRules();
  const [rules, setRules] = useState<EditableRule[]>([]);
  // Errors show under the empty message only after a save attempt, never on open.
  const [showErrors, setShowErrors] = useState(false);
  const baseId = useId();
  const messageId = (i: number) => `${baseId}-message-${i}`;

  useEffect(() => {
    if (rulesQuery.data) setRules(rulesQuery.data.map(toEditable));
  }, [rulesQuery.data]);

  const save = trpc.monitoring.configureAlertRules.useMutation({
    onSuccess: () => {
      // configureAlertRules is a WRITE and was NOT ported (#100 is read-only), so it stays a tRPC
      // mutation. Both cache families must be refreshed: the tRPC keys below are the live reads
      // while NEXT_PUBLIC_MONITORING_READ_VIA_CSHARP is off, and the ['platform-api','monitoring']
      // keys are the live reads once it is on. Invalidating only the tRPC four would leave the
      // whole dashboard stale after cutover — the reads are served from a different cache.
      // Each call is a no-op against the path that is not active (its queries never populate).
      utils.monitoring.getAlertRules.invalidate();
      utils.monitoring.getActiveAlerts.invalidate();
      utils.monitoring.getExecutiveKpis.invalidate();
      utils.monitoring.getModuleHealth.invalidate();
      invalidateMonitoringPlatformReads(queryClient);
      toast(ar.rulesSaved, { type: 'success' });
      onClose();
    },
    onError: (err) => toast(err.message || ar.saveError, { type: 'error' }),
  });

  const update = (i: number, patch: Partial<EditableRule>) =>
    setRules((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const handleSave = () => {
    const firstInvalid = rules.findIndex((r) => r.message.trim().length === 0);
    if (firstInvalid >= 0) {
      setShowErrors(true);
      document.getElementById(messageId(firstInvalid))?.focus();
      return;
    }
    save.mutate({
      rules: rules.map((r) => ({
        ...(r.id ? { id: r.id } : {}),
        module: ALERT_METRIC_MODULE[r.metric],
        condition: { metric: r.metric, operator: r.operator, threshold: r.threshold },
        severity: r.severity,
        message: r.message.trim(),
        isActive: r.isActive,
      })),
    });
  };

  const loaded = !rulesQuery.isLoading && !rulesQuery.isError;
  const footer = loaded ? (
    <div className={BUTTON_GROUP_CLASSES}>
      <Button variant="secondary" onClick={onClose}>
        {t.common.cancel}
      </Button>
      <Button onClick={handleSave} loading={save.isPending} loadingLabel={t.common.saving}>
        {ar.saveRules}
      </Button>
    </div>
  ) : undefined;

  return (
    <Modal title={ar.title} description={ar.subtitle} onClose={onClose} size="xl" footer={footer}>
      {rulesQuery.isLoading ? (
        <div className="space-y-3" aria-busy="true">
          <span className="sr-only">{t.common.loadingContent}</span>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : rulesQuery.isError ? (
        <ErrorState size="compact" onRetry={() => rulesQuery.refetch()} error={rulesQuery.error} />
      ) : (
        <>
          <ul className="space-y-3">
            {rules.length === 0 && <li className="py-6 text-center text-body text-secondary">{ar.noRules}</li>}
            {rules.map((r, i) => {
              const messageError = showErrors && r.message.trim().length === 0 ? ar.messageError : undefined;
              return (
                <li key={r.id ?? `new-${i}`} className="space-y-3 rounded-xl border border-border p-3">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-[minmax(0,1fr)_6rem_7rem_8rem] sm:items-end">
                    <Field label={ar.metric} className="col-span-2 sm:col-span-1">
                      <select
                        value={r.metric}
                        onChange={(e) => update(i, { metric: e.target.value as AlertMetricKey })}
                        className={selectClasses()}
                      >
                        {ALERT_METRIC_KEYS.map((k) => (
                          <option key={k} value={k}>
                            {ar[`metric_${k}`] ?? k}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label={ar.operator}>
                      <select
                        value={r.operator}
                        onChange={(e) => update(i, { operator: e.target.value as AlertOperator })}
                        className={selectClasses()}
                      >
                        {ALERT_OPERATORS.map((op) => (
                          <option key={op} value={op}>
                            {OPERATOR_SYMBOL[op]}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label={ar.threshold}>
                      <input
                        type="number"
                        value={r.threshold}
                        onChange={(e) => update(i, { threshold: Number(e.target.value) })}
                        className={inputClasses()}
                      />
                    </Field>
                    <Field label={ar.severity}>
                      <select
                        value={r.severity}
                        onChange={(e) => update(i, { severity: e.target.value as Severity })}
                        className={selectClasses()}
                      >
                        <option value="info">{ar.sev_info}</option>
                        <option value="warning">{ar.sev_warning}</option>
                        <option value="critical">{ar.sev_critical}</option>
                      </select>
                    </Field>
                  </div>
                  <Field
                    id={messageId(i)}
                    label={ar.messageLabel}
                    help={ar.messagePlaceholder}
                    error={messageError}
                    required
                  >
                    <input
                      type="text"
                      maxLength={500}
                      value={r.message}
                      onChange={(e) => update(i, { message: e.target.value })}
                      className={inputClasses()}
                    />
                  </Field>
                  <label className={CHOICE_ROW_CLASSES}>
                    <input
                      type="checkbox"
                      checked={r.isActive}
                      onChange={(e) => update(i, { isActive: e.target.checked })}
                      className={CHOICE_INPUT_CLASSES}
                    />
                    {ar.active}
                  </label>
                </li>
              );
            })}
          </ul>

          <Button
            variant="tertiary"
            className="mt-3"
            onClick={() => setRules((rs) => [...rs, newRule()])}
            icon={
              <svg
                className="size-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            }
          >
            {ar.addRule}
          </Button>
        </>
      )}
    </Modal>
  );
}
