'use client';

import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';

function KpiSkeleton() {
  return <div className="bg-white rounded-xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] animate-pulse"><div className="h-20 bg-gray-100 rounded" /></div>;
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
  const kpis = trpc.dei.getDashboardKpis.useQuery();
  const genders = trpc.dei.getGenderRepresentation.useQuery();
  const pay = trpc.dei.getPayEquity.useQuery();
  const inclusion = trpc.dei.getInclusionIndex.useQuery();

  if (kpis.isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        {Array.from({ length: 5 }).map((_, i) => <KpiSkeleton key={i} />)}
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

  const d = kpis.data;
  const byGender = Object.fromEntries((genders.data ?? []).map((g) => [g.gender, g.percentage]));
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

      {/* Parity index */}
      <KpiCard label={t.dei.kpiParity} sub={t.dei.kpiParityHint}>
        <p className="text-[20px] md:text-[24px] font-bold text-[#1F114C]">{d.genderParityIndex.toFixed(2)}</p>
        <p className="text-[10px] text-[#8B8B8B]">{d.womenPct}{t.dei.womenSuffix}</p>
      </KpiCard>

      {/* Pay gap */}
      <KpiCard label={t.dei.kpiPayGap} sub={t.dei.kpiPayGapHint}>
        {gap === null || gap === undefined ? (
          <p className="text-[18px] font-bold text-[#8B8B8B] mt-2">{t.dei.na}</p>
        ) : (
          <p className={`text-[20px] md:text-[24px] font-bold ${Math.abs(gap) < 3 ? 'text-green-600' : Math.abs(gap) <= 5 ? 'text-amber-500' : 'text-[#DD0C15]'}`}>
            {gap > 0 ? '+' : ''}{gap}%
          </p>
        )}
      </KpiCard>

      {/* Inclusion */}
      <KpiCard label={t.dei.kpiInclusion} sub={t.dei.kpiInclusionHint}>
        <p className="text-[20px] md:text-[24px] font-bold text-green-600">{inclusion.data?.index ?? t.dei.na}</p>
      </KpiCard>

      {/* Demographics coverage */}
      <KpiCard label={t.dei.kpiCoverage} sub={`${d.totalEmployees} ${t.dei.employeesSuffix}`}>
        <p className="text-[20px] md:text-[24px] font-bold text-[#1F114C]">{d.demographicsCoverage}%</p>
        <p className="text-[10px] text-[#8B8B8B]">{d.totalNationalities} {t.dei.nationalitiesSuffix}</p>
      </KpiCard>
    </div>
  );
}
