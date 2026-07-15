'use client';

import { useI18n } from '../../../lib/i18n';
import { ErrorState } from '../../../components';
import { formatCurrency } from '../../../lib/format-utils';

interface CompKpisProps {
  data: {
    // min-5 suppression (round 6): payroll/avgSalary/compensatedEmployees are nulled
    // when the compensated population is 1..4; avgCompaRatio when the compaRatio
    // population is <5. Render a mask ('N/D') for null values.
    totalMonthlyPayroll: number | null;
    avgSalary: number | null;
    currency?: string;
    activeEmployees: number;
    compensatedEmployees: number | null;
    // pendingAdjustments is min-5 floored (round 7): null when 1..4 pending. Mask it.
    pendingAdjustments: number | null;
    benefitsUtilizationPct: number;
    avgCompaRatio: number | null;
  } | null;
  loading: boolean;
  isError?: boolean;
  onRetry?: () => void;
}

function KpiSkeleton() {
  return <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4 animate-pulse"><div className="h-16 bg-gray-100 rounded" /></div>;
}

export function CompKpis({ data, loading, isError, onRetry }: CompKpisProps) {
  const { t } = useI18n();

  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
        {Array.from({ length: 5 }).map((_, i) => <KpiSkeleton key={i} />)}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mb-4">
        <ErrorState onRetry={onRetry} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
        {Array.from({ length: 5 }).map((_, i) => <KpiSkeleton key={i} />)}
      </div>
    );
  }

  const cr = data.avgCompaRatio;
  const benefits = data.benefitsUtilizationPct;
  const currency = data.currency ?? 'USD';

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4">
        <div className="text-[11px] text-[#8B8B8B] font-medium mb-1">{t.compensation.kpiPayroll}</div>
        <span className="text-[20px] md:text-[26px] font-bold text-[#333] leading-none">{data.totalMonthlyPayroll === null ? t.dei.na : formatCurrency(data.totalMonthlyPayroll, currency)}</span>
        <div className="text-[10px] text-[#8B8B8B] mt-1.5">{data.compensatedEmployees === null ? t.dei.na : data.compensatedEmployees} {t.compensation.employeesShort}</div>
      </div>

      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4">
        <div className="text-[11px] text-[#8B8B8B] font-medium mb-1">{t.compensation.kpiAvgSalary}</div>
        <span className="text-[20px] md:text-[26px] font-bold text-[#333] leading-none">{data.avgSalary === null ? t.dei.na : formatCurrency(data.avgSalary, currency)}</span>
        <div className="text-[10px] text-[#8B8B8B] mt-1.5">{data.activeEmployees} {t.compensation.activeEmployeesSuffix}</div>
      </div>

      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4">
        <div className="text-[11px] text-[#8B8B8B] font-medium mb-1">{t.compensation.kpiCompaRatio}</div>
        <div className="flex items-end gap-2">
          <span className="text-[20px] md:text-[26px] font-bold text-[#333] leading-none">{cr === null ? t.dei.na : cr.toFixed(2)}</span>
          {cr !== null && cr >= 0.95 && cr <= 1.05 && <span className="text-[11px] text-green-600 font-medium mb-1">{t.compensation.inRange}</span>}
        </div>
        {cr !== null && <div className="w-full h-1.5 bg-[#EDEDED] rounded-full mt-2"><div className="h-full bg-green-500 rounded-full" style={{ width: `${Math.min(cr * 100, 100)}%` }} /></div>}
      </div>

      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4">
        <div className="text-[11px] text-[#8B8B8B] font-medium mb-1">{t.compensation.kpiBenefitsUtil}</div>
        <span className="text-[20px] md:text-[26px] font-bold text-[#333] leading-none">{benefits}%</span>
        <div className="w-full h-1.5 bg-[#EDEDED] rounded-full mt-2"><div className="h-full bg-amber-400 rounded-full" style={{ width: `${Math.min(benefits, 100)}%` }} /></div>
      </div>

      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4">
        <div className="text-[11px] text-[#8B8B8B] font-medium mb-1">{t.compensation.kpiPending}</div>
        <span className={`text-[20px] md:text-[26px] font-bold leading-none ${(data.pendingAdjustments ?? 0) > 0 ? 'text-[#DD0C15]' : 'text-[#333]'}`}>{data.pendingAdjustments === null ? t.dei.na : data.pendingAdjustments}</span>
      </div>
    </div>
  );
}
