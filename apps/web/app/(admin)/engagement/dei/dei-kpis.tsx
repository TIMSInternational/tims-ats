'use client';

import { useI18n } from '../../../../lib/i18n';
import { ErrorState } from '../../../../components';
import {
  useDeiDashboardKpis,
  useDeiGenderRepresentation,
  useDeiPayEquity,
  useDeiInclusionIndex,
} from '../../../../lib/platform-api/dei';

function KpiSkeleton() {
  return (
    <div className="bg-white rounded-xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] animate-pulse">
      <div className="h-20 bg-gray-100 rounded" />
    </div>
  );
}

function KpiCard({ label, children, sub }: { label: string; children: React.ReactNode; sub?: string }) {
  return (
    <div className="bg-white rounded-xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] text-center">
      <p className="text-[11px] text-[#8B8B8B] mb-1">{label}</p>
      {children}
      {sub && <p className="text-[10px] text-[#8B8B8B] mt-1">{sub}</p>}
    </div>
  );
}

export function DeiKpis() {
  const { t } = useI18n();
  const kpis = useDeiDashboardKpis();
  const genders = useDeiGenderRepresentation();
  const pay = useDeiPayEquity();
  const inclusion = useDeiInclusionIndex();

  if (kpis.isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <KpiSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (kpis.isError || !kpis.data) {
    return (
      <div className="bg-white rounded-xl p-4 mb-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] text-center text-[12px] text-[#DD0C15]">
        {t.dei.errKpis}
      </div>
    );
  }

  if (genders.isError || pay.isError || inclusion.isError) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <div className="col-span-2 md:col-span-5 bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <ErrorState
            onRetry={() => {
              genders.refetch();
              pay.refetch();
              inclusion.refetch();
            }}
          />
        </div>
      </div>
    );
  }

  const d = kpis.data;
  // Suppressed gender distribution (round 7) returns empty groups → ratio bar shows 0%
  // for all (never a real share). Read from the { groups, suppressed } shape.
  const byGender = Object.fromEntries((genders.data?.groups ?? []).map((g) => [g.gender, g.percentage ?? 0]));
  const male = byGender.male ?? 0;
  const female = byGender.female ?? 0;
  const nb = byGender.non_binary ?? 0;
  const gap = pay.data?.gapPct;

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
      {/* Gender ratio */}
      <KpiCard label={t.dei.kpiGenderRatio} sub={t.dei.kpiGenderRatioHint}>
        <div className="flex items-center justify-center gap-2 my-1">
          <span className="text-[11px] font-semibold text-blue-600">{male}%</span>
          <span className="text-[11px] font-semibold text-pink-500">{female}%</span>
          <span className="text-[11px] font-semibold text-purple-400">{nb}%</span>
        </div>
        <div className="flex gap-0.5 h-2 rounded-full overflow-hidden mt-2">
          <div className="bg-blue-500" style={{ width: `${male}%` }} />
          <div className="bg-pink-400" style={{ width: `${female}%` }} />
          <div className="bg-purple-400" style={{ width: `${nb}%` }} />
        </div>
      </KpiCard>

      {/* Parity index — null when any gender group is min-5 suppressed (cross-endpoint differencing guard). */}
      <KpiCard label={t.dei.kpiParity} sub={t.dei.kpiParityHint}>
        <p className="text-[20px] md:text-[24px] font-bold text-[#1F114C]">
          {d.genderParityIndex === null ? t.dei.na : d.genderParityIndex.toFixed(2)}
        </p>
        <p className="text-[10px] text-[#8B8B8B]">
          {d.womenPct === null ? t.dei.na : `${d.womenPct}${t.dei.womenSuffix}`}
        </p>
      </KpiCard>

      {/* Pay gap */}
      <KpiCard label={t.dei.kpiPayGap} sub={t.dei.kpiPayGapHint}>
        {gap === null || gap === undefined ? (
          <p className="text-[18px] font-bold text-[#8B8B8B] mt-2">{t.dei.na}</p>
        ) : (
          <p
            className={`text-[20px] md:text-[24px] font-bold ${Math.abs(gap) < 3 ? 'text-green-600' : Math.abs(gap) <= 5 ? 'text-amber-500' : 'text-[#DD0C15]'}`}
          >
            {gap > 0 ? '+' : ''}
            {gap}%
          </p>
        )}
      </KpiCard>

      {/* Inclusion */}
      <KpiCard label={t.dei.kpiInclusion} sub={t.dei.kpiInclusionHint}>
        <p className="text-[20px] md:text-[24px] font-bold text-green-600">{inclusion.data?.index ?? t.dei.na}</p>
      </KpiCard>

      {/* Demographics coverage */}
      <KpiCard label={t.dei.kpiCoverage} sub={`${d.totalEmployees} ${t.dei.employeesSuffix}`}>
        <p className="text-[20px] md:text-[24px] font-bold text-[#1F114C]">
          {d.demographicsCoverage === null ? t.dei.na : `${d.demographicsCoverage}%`}
        </p>
        <p className="text-[10px] text-[#8B8B8B]">
          {d.totalNationalities} {t.dei.nationalitiesSuffix}
        </p>
      </KpiCard>
    </div>
  );
}
