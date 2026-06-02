'use client';

interface ClimateKpisProps {
  enps: { enps: number; totalResponses: number } | null;
  dashKpis: { activeSurveys: number; totalResponses: number; actionPlansOpen: number; highRiskCount: number } | null;
  loading: boolean;
}

function KpiSkeleton() {
  return <div className="bg-white rounded-xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] animate-pulse"><div className="h-16 bg-gray-100 rounded" /></div>;
}

export function ClimateKpis({ enps, dashKpis, loading }: ClimateKpisProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-5 gap-3 mb-4">
        {Array.from({ length: 5 }).map((_, i) => <KpiSkeleton key={i} />)}
      </div>
    );
  }

  const enpsScore = enps?.enps ?? 0;
  const enpsColor = enpsScore >= 30 ? 'text-green-600' : enpsScore >= 0 ? 'text-amber-500' : 'text-[#DD0C15]';

  return (
    <div className="grid grid-cols-5 gap-3 mb-4">
      {/* eNPS Score */}
      <div className="bg-white rounded-xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] text-center">
        <p className="text-[11px] text-[#8B8B8B] mb-1">eNPS Score</p>
        <div className="relative w-16 h-8 mx-auto mb-1">
          <svg viewBox="0 0 100 50" className="w-full">
            <path d="M5 50 A45 45 0 0 1 95 50" fill="none" stroke="#EDEDED" strokeWidth="8" strokeLinecap="round" />
            <path d="M5 50 A45 45 0 0 1 78 12" fill="none" stroke="#22c55e" strokeWidth="8" strokeLinecap="round" />
          </svg>
        </div>
        <p className={`text-[26px] font-bold ${enpsColor}`}>{enpsScore > 0 ? '+' : ''}{enpsScore}</p>
        <p className="text-[10px] text-green-500 font-medium">+8 vs anterior</p>
      </div>

      {/* Participacion */}
      <div className="bg-white rounded-xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] text-center">
        <p className="text-[11px] text-[#8B8B8B] mb-1">Participacion</p>
        <p className="text-[26px] font-bold text-[#1F114C]">87%</p>
        <p className="text-[10px] text-green-500 font-medium">+5% vs Q1</p>
      </div>

      {/* Ultima Encuesta */}
      <div className="bg-white rounded-xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] text-center">
        <p className="text-[11px] text-[#8B8B8B] mb-1">Ultima Encuesta</p>
        <p className="text-[26px] font-bold text-[#1F114C]">15 May</p>
        <p className="text-[10px] text-[#8B8B8B]">Trimestral Q2 2026</p>
      </div>

      {/* Alertas Bajo Clima */}
      <div className="bg-white rounded-xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] text-center">
        <p className="text-[11px] text-[#8B8B8B] mb-1">Alertas Bajo Clima</p>
        <p className="text-[26px] font-bold text-[#DD0C15]">{dashKpis?.actionPlansOpen ?? 3}</p>
        <p className="text-[10px] text-[#DD0C15]">areas criticas</p>
      </div>

      {/* Riesgo de Rotacion */}
      <div className="bg-white rounded-xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] text-center">
        <p className="text-[11px] text-[#8B8B8B] mb-1">Riesgo de Rotacion</p>
        <p className="text-[26px] font-bold text-amber-500">12%</p>
        <p className="text-[10px] text-amber-500 font-medium">+2% vs Q1</p>
      </div>
    </div>
  );
}
