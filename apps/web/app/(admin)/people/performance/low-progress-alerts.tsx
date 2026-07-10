'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import type { LowProgressOkr, OverdueCommitment } from '../../../../lib/trpc-types';
import {
  getOkrProgressSeverity,
  getCommitmentSeverity,
  getDaysOverdue,
  type AlertSeverity,
} from '../../../../lib/low-progress-alerts-helpers';

const SEV_META: Record<AlertSeverity, { badge: string; border: string }> = {
  critical: { badge: 'bg-[#DD0C15]', border: 'border-red-200 bg-red-50/50' },
  warning: { badge: 'bg-amber-500', border: 'border-amber-200 bg-amber-50/50' },
};

const THRESHOLD_OPTIONS = [10, 20, 30, 50] as const;

interface LowProgressAlertsPanelProps {
  /** No OKR detail route exists in this app today (verified — see Sprint 1.4 Task 2 report).
   * The closest real navigation target is this same page's "OKRs" tab, so a row click
   * switches the parent's active tab there instead of linking to a fabricated route. */
  onSelectOkr?: () => void;
  /** Same caveat as `onSelectOkr` — routes to the "Coaching" tab, where commitments live. */
  onSelectCommitment?: () => void;
}

export function LowProgressAlertsPanel({ onSelectOkr, onSelectCommitment }: LowProgressAlertsPanelProps) {
  const { t } = useI18n();
  const [threshold, setThreshold] = useState<number>(30);
  const q = trpc.performance.getLowProgressAlerts.useQuery({ threshold });

  const lowOkrs = q.data?.lowProgressOkrs ?? [];
  const overdueCommitments = q.data?.overdueCommitments ?? [];
  const total = q.data?.totalAlerts ?? 0;

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <div className="flex items-center justify-between px-5 py-3 border-b border-[#EDEDED]">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-[#DD0C15]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
          </svg>
          <span className="text-[13px] font-semibold text-[#333]">{t.performance.lowProgressAlertsTitle}</span>
          {total > 0 && (
            <span className="text-[10px] bg-[#DD0C15] text-white px-1.5 py-0.5 rounded-full font-bold">{total}</span>
          )}
        </div>
        <label className="flex items-center gap-1.5 text-[11px] text-[#8B8B8B]">
          {t.performance.lowProgressThresholdLabel}
          <select
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="text-[11px] border border-[#EDEDED] rounded-lg px-2 py-1 text-[#585858] bg-white"
          >
            {THRESHOLD_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}%
              </option>
            ))}
          </select>
        </label>
      </div>

      {q.isLoading ? (
        <div className="p-4 space-y-2">
          <div className="h-14 bg-gray-50 rounded animate-pulse" />
          <div className="h-14 bg-gray-50 rounded animate-pulse" />
        </div>
      ) : q.isError ? (
        <p className="text-[12px] text-[#DD0C15] p-4">{t.performance.lowProgressAlertsErr}</p>
      ) : total === 0 ? (
        <p className="text-[12px] text-[#8B8B8B] p-4">{t.performance.lowProgressAlertsEmpty}</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3">
          <OkrAlertList okrs={lowOkrs} threshold={threshold} onSelect={onSelectOkr} />
          <CommitmentAlertList commitments={overdueCommitments} onSelect={onSelectCommitment} />
        </div>
      )}
    </div>
  );
}

function OkrAlertList({
  okrs,
  threshold,
  onSelect,
}: {
  okrs: LowProgressOkr[];
  threshold: number;
  onSelect?: () => void;
}) {
  const { t } = useI18n();
  if (okrs.length === 0) {
    return <p className="text-[11px] text-[#8B8B8B] px-1 py-2">{t.performance.lowProgressNoOkrs}</p>;
  }
  return (
    <div className="space-y-2">
      <h4 className="text-[10px] font-semibold text-[#585858] uppercase tracking-wide px-1">
        {t.performance.lowProgressOkrsHeading}
      </h4>
      {okrs.map((okr) => {
        const sev = getOkrProgressSeverity(okr.progress, threshold);
        const meta = SEV_META[sev];
        const name = okr.user ? `${okr.user.firstName} ${okr.user.lastName}` : 'N/A';
        return (
          <button
            key={okr.id}
            type="button"
            onClick={onSelect}
            className={`w-full text-left border rounded-lg p-3 hover:opacity-90 transition ${meta.border}`}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-[9px] font-bold ${meta.badge} text-white px-1.5 py-0.5 rounded uppercase`}>
                {sev === 'critical' ? t.performance.severityCritical : t.performance.severityWarning}
              </span>
              {okr.team && <span className="text-[9px] bg-[#1F114C] text-white px-1.5 py-0.5 rounded">{okr.team.name}</span>}
            </div>
            <p className="text-[11px] text-[#333] font-medium leading-tight">{okr.title}</p>
            <p className="text-[10px] text-[#585858] leading-tight mt-0.5">
              {name} &middot; {okr.progress}%
            </p>
          </button>
        );
      })}
    </div>
  );
}

function CommitmentAlertList({
  commitments,
  onSelect,
}: {
  commitments: OverdueCommitment[];
  onSelect?: () => void;
}) {
  const { t } = useI18n();
  if (commitments.length === 0) {
    return <p className="text-[11px] text-[#8B8B8B] px-1 py-2">{t.performance.lowProgressNoCommitments}</p>;
  }
  return (
    <div className="space-y-2">
      <h4 className="text-[10px] font-semibold text-[#585858] uppercase tracking-wide px-1">
        {t.performance.lowProgressCommitmentsHeading}
      </h4>
      {commitments.map((c) => {
        const sev = getCommitmentSeverity(c.dueDate);
        const meta = SEV_META[sev];
        const days = getDaysOverdue(c.dueDate);
        const name = c.employee ? `${c.employee.firstName} ${c.employee.lastName}` : 'N/A';
        return (
          <button
            key={c.id}
            type="button"
            onClick={onSelect}
            className={`w-full text-left border rounded-lg p-3 hover:opacity-90 transition ${meta.border}`}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-[9px] font-bold ${meta.badge} text-white px-1.5 py-0.5 rounded uppercase`}>
                {sev === 'critical' ? t.performance.severityCritical : t.performance.severityWarning}
              </span>
            </div>
            <p className="text-[11px] text-[#333] font-medium leading-tight">{c.description}</p>
            <p className="text-[10px] text-[#585858] leading-tight mt-0.5">
              {name} &middot; {t.performance.lowProgressDaysOverdue.replace('{n}', String(days))}
            </p>
          </button>
        );
      })}
    </div>
  );
}
