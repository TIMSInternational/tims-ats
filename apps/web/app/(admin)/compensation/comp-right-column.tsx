'use client';

import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';

const fmtCOP = (n: number) => `$${Math.round(n / 1000).toLocaleString('es-CO')}K`;

// Compa-ratio buckets as returned by getCompaRatioDistribution, with display meta.
const CR_BUCKETS = [
  { key: '<0.80', label: '< 0.80', color: 'bg-[#DD0C15]', textColor: 'text-[#DD0C15]', tag: 'crUnderpaid' as const },
  { key: '0.80-0.90', label: '0.80 - 0.90', color: 'bg-amber-400', textColor: 'text-amber-600', tag: 'crBelow' as const },
  { key: '0.90-1.00', label: '0.90 - 1.00', color: 'bg-green-500', textColor: 'text-green-600', tag: 'crOnTarget' as const },
  { key: '1.00-1.10', label: '1.00 - 1.10', color: 'bg-green-500', textColor: 'text-green-600', tag: 'crOnTarget' as const },
  { key: '1.10-1.20', label: '1.10 - 1.20', color: 'bg-blue-400', textColor: 'text-blue-600', tag: 'crAbove' as const },
  { key: '>1.20', label: '> 1.20', color: 'bg-amber-500', textColor: 'text-amber-600', tag: 'crOver' as const },
];

export function CompaRatioDistribution() {
  const { t } = useI18n();
  const q = trpc.compensation.getCompaRatioDistribution.useQuery();
  const total = q.data?.totalEmployees ?? 0;

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
      <div className="text-[13px] font-semibold text-[#333] mb-3">{t.compensation.compaRatioDist}</div>
      {q.isLoading ? (
        <div className="h-32 bg-gray-50 rounded animate-pulse" />
      ) : q.isError ? (
        <p className="text-[12px] text-[#DD0C15]">{t.compensation.compaRatioErr}</p>
      ) : (
        <div className="space-y-2.5">
          {CR_BUCKETS.map((b) => {
            const count = q.data?.distribution[b.key] ?? 0;
            const pct = total ? Math.round((count / total) * 100) : 0;
            return (
              <div key={b.key} className="flex items-center gap-3">
                <div className="w-[80px] text-[10px] text-[#585858] shrink-0">{b.label}</div>
                <div className="flex-1 h-5 bg-[#EDEDED] rounded-full overflow-hidden">
                  <div className={`h-full ${b.color} rounded-full`} style={{ width: `${pct}%` }} />
                </div>
                <div className="w-[64px] flex items-center gap-1 shrink-0">
                  <span className={`text-[11px] font-semibold ${b.textColor}`}>{count}</span>
                  <span className="text-[9px] text-[#8B8B8B]">{t.compensation[b.tag]}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function BenefitsUtilization() {
  const { t } = useI18n();
  const q = trpc.compensation.getBenefitsUtilization.useQuery();

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
      <div className="text-[13px] font-semibold text-[#333] mb-3">{t.compensation.benefitsUtil}</div>
      {q.isLoading ? (
        <div className="h-28 bg-gray-50 rounded animate-pulse" />
      ) : q.isError ? (
        <p className="text-[12px] text-[#DD0C15]">{t.compensation.benefitsErr}</p>
      ) : !q.data || q.data.length === 0 ? (
        <p className="text-[12px] text-[#8B8B8B]">{t.compensation.benefitsEmpty}</p>
      ) : (
        <div className="space-y-2.5">
          {q.data.map((b) => (
            <div key={b.id}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] text-[#585858]">{b.name}</span>
                <span className="text-[11px] font-semibold text-[#333]">{b.utilization}%</span>
              </div>
              <div className="w-full h-2 bg-[#EDEDED] rounded-full">
                <div className={`h-full rounded-full ${b.utilization >= 75 ? 'bg-green-500' : b.utilization >= 50 ? 'bg-[#1F114C]' : 'bg-amber-400'}`} style={{ width: `${Math.min(b.utilization, 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const ADJ_LABEL: Record<string, 'adjMerit' | 'adjPromotion' | 'adjMarket' | 'adjEquity' | 'adjOther'> = {
  merit: 'adjMerit', promotion: 'adjPromotion', market: 'adjMarket', equity: 'adjEquity', other: 'adjOther',
};

export function PendingAdjustments() {
  const { t } = useI18n();
  const q = trpc.compensation.listPendingAdjustments.useQuery();

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[13px] font-semibold text-[#333]">{t.compensation.pendingTitle}</div>
        {q.data && q.data.length > 0 && <span className="text-[10px] text-[#DD0C15] font-medium">{q.data.length}</span>}
      </div>
      {q.isLoading ? (
        <div className="h-28 bg-gray-50 rounded animate-pulse" />
      ) : q.isError ? (
        <p className="text-[12px] text-[#DD0C15]">{t.compensation.pendingErr}</p>
      ) : !q.data || q.data.length === 0 ? (
        <p className="text-[12px] text-[#8B8B8B]">{t.compensation.pendingEmpty}</p>
      ) : (
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-[#EDEDED] text-[#8B8B8B]">
              <th className="text-left font-medium pb-2">{t.compensation.colEmployee}</th>
              <th className="text-left font-medium pb-2">{t.compensation.colType}</th>
              <th className="text-right font-medium pb-2">{t.compensation.colChange}</th>
            </tr>
          </thead>
          <tbody className="text-[#333]">
            {q.data.map((a, i) => {
              const prev = Number(a.previousSalary);
              const next = Number(a.newSalary);
              const pct = prev ? Math.round(((next - prev) / prev) * 1000) / 10 : 0;
              return (
                <tr key={a.id} className={i < q.data!.length - 1 ? 'border-b border-[#EDEDED]/60' : ''}>
                  <td className="py-1.5 font-medium">{a.user.firstName} {a.user.lastName}</td>
                  <td className="py-1.5 text-[#8B8B8B]">{t.compensation[ADJ_LABEL[a.type] ?? 'adjOther']}</td>
                  <td className="py-1.5 text-right"><span className="font-semibold text-green-600">+{pct}%</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
