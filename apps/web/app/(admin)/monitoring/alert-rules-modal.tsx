'use client';

import { useState, useEffect } from 'react';
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
import { ErrorState } from '../../../components';

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
    const invalid = rules.find((r) => r.message.trim().length === 0);
    if (invalid) {
      toast(ar.messageRequired, { type: 'error' });
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

  return (
    <Modal title={ar.title} onClose={onClose} maxWidth="max-w-3xl">
      <p className="text-[13px] text-[#8B8B8B] -mt-3 mb-4">{ar.subtitle}</p>

      {rulesQuery.isLoading ? (
        <p className="text-[13px] text-[#585858] py-6 text-center">{t.common.loading}</p>
      ) : rulesQuery.isError ? (
        <ErrorState onRetry={() => rulesQuery.refetch()} />
      ) : (
        <>
          <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
            {rules.length === 0 && <p className="text-[13px] text-[#8B8B8B] py-6 text-center">{ar.noRules}</p>}
            {rules.map((r, i) => (
              <div key={r.id ?? `new-${i}`} className="rounded-xl border border-[#EDEDED] p-3 space-y-2.5">
                <div className="flex flex-wrap items-end gap-2">
                  <label className="flex flex-col gap-1 flex-1 min-w-[160px]">
                    <span className="text-[11px] font-medium text-[#8B8B8B]">{ar.metric}</span>
                    <select
                      value={r.metric}
                      onChange={(e) => update(i, { metric: e.target.value as AlertMetricKey })}
                      className="h-9 px-2.5 rounded-lg border border-[#EDEDED] text-[13px] bg-white focus:outline-none focus:border-[#1F114C]"
                    >
                      {ALERT_METRIC_KEYS.map((k) => (
                        <option key={k} value={k}>
                          {ar[`metric_${k}`] ?? k}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 w-[90px]">
                    <span className="text-[11px] font-medium text-[#8B8B8B]">{ar.operator}</span>
                    <select
                      value={r.operator}
                      onChange={(e) => update(i, { operator: e.target.value as AlertOperator })}
                      className="h-9 px-2.5 rounded-lg border border-[#EDEDED] text-[13px] bg-white focus:outline-none focus:border-[#1F114C]"
                    >
                      {ALERT_OPERATORS.map((op) => (
                        <option key={op} value={op}>
                          {OPERATOR_SYMBOL[op]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 w-[110px]">
                    <span className="text-[11px] font-medium text-[#8B8B8B]">{ar.threshold}</span>
                    <input
                      type="number"
                      value={r.threshold}
                      onChange={(e) => update(i, { threshold: Number(e.target.value) })}
                      className="h-9 px-2.5 rounded-lg border border-[#EDEDED] text-[13px] focus:outline-none focus:border-[#1F114C]"
                    />
                  </label>
                  <label className="flex flex-col gap-1 w-[130px]">
                    <span className="text-[11px] font-medium text-[#8B8B8B]">{ar.severity}</span>
                    <select
                      value={r.severity}
                      onChange={(e) => update(i, { severity: e.target.value as Severity })}
                      className="h-9 px-2.5 rounded-lg border border-[#EDEDED] text-[13px] bg-white focus:outline-none focus:border-[#1F114C]"
                    >
                      <option value="info">{ar.sev_info}</option>
                      <option value="warning">{ar.sev_warning}</option>
                      <option value="critical">{ar.sev_critical}</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-1.5 h-9 px-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={r.isActive}
                      onChange={(e) => update(i, { isActive: e.target.checked })}
                      className="accent-[#1F114C]"
                    />
                    <span className="text-[12px] text-[#585858]">{ar.active}</span>
                  </label>
                </div>
                <input
                  type="text"
                  maxLength={500}
                  value={r.message}
                  onChange={(e) => update(i, { message: e.target.value })}
                  placeholder={ar.messagePlaceholder}
                  className="w-full h-9 px-2.5 rounded-lg border border-[#EDEDED] text-[13px] focus:outline-none focus:border-[#1F114C]"
                />
              </div>
            ))}
          </div>

          <button
            onClick={() => setRules((rs) => [...rs, newRule()])}
            className="mt-3 flex items-center gap-1.5 text-[13px] text-[#1F114C] font-medium hover:underline"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            {ar.addRule}
          </button>

          <div className="flex gap-3 pt-5 mt-2 border-t border-[#EDEDED]">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 h-10 rounded-lg border border-[#EDEDED] text-[13px] font-medium text-[#585858] hover:bg-[#F6F6F6] transition"
            >
              {t.common.cancel}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={save.isPending}
              className="flex-1 h-10 rounded-lg bg-[#DD0C15] text-[13px] text-white font-medium hover:bg-[#c40b13] transition disabled:opacity-60"
            >
              {save.isPending ? t.common.loading : t.common.save}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
