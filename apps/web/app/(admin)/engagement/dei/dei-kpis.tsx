'use client';

function KpiSkeleton() {
  return <div className="bg-white rounded-xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] animate-pulse"><div className="h-20 bg-gray-100 rounded" /></div>;
}

interface DeiKpisProps {
  loading: boolean;
}

export function DeiKpis({ loading }: DeiKpisProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-5 gap-3 mb-4">
        {Array.from({ length: 5 }).map((_, i) => <KpiSkeleton key={i} />)}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-5 gap-3 mb-4">
      {/* Gender Ratio */}
      <div className="bg-white rounded-xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] text-center">
        <p className="text-[11px] text-[#8B8B8B] mb-1">Ratio de Genero</p>
        <div className="flex items-center justify-center gap-2 my-1">
          <span className="text-[11px] font-semibold text-blue-600">58%</span>
          <span className="text-[11px] font-semibold text-pink-500">39%</span>
          <span className="text-[11px] font-semibold text-purple-400">3%</span>
        </div>
        <div className="flex gap-0.5 h-2 rounded-full overflow-hidden mt-2">
          <div className="bg-blue-500" style={{ width: '58%' }} />
          <div className="bg-pink-400" style={{ width: '39%' }} />
          <div className="bg-purple-400" style={{ width: '3%' }} />
        </div>
        <p className="text-[10px] text-[#8B8B8B] mt-1">M / F / NB</p>
      </div>

      {/* Diversity Index */}
      <div className="bg-white rounded-xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] text-center">
        <p className="text-[11px] text-[#8B8B8B] mb-1">Indice de Diversidad</p>
        <p className="text-[24px] font-bold text-[#1F114C]">7.4</p>
        <p className="text-[10px] text-[#8B8B8B]">de 10</p>
        <div className="flex items-center justify-center gap-1 mt-1">
          <svg className="w-3 h-3 text-green-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="m4.5 15.75 7.5-7.5 7.5 7.5" /></svg>
          <span className="text-[10px] text-green-500 font-medium">+0.3 vs Q1</span>
        </div>
      </div>

      {/* Pay Equity Gap */}
      <div className="bg-white rounded-xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] text-center">
        <p className="text-[11px] text-[#8B8B8B] mb-1">Brecha Salarial</p>
        <p className="text-[24px] font-bold text-amber-500">4.2%</p>
        <p className="text-[10px] text-[#8B8B8B]">gap promedio M vs F</p>
        <div className="flex items-center justify-center gap-1 mt-1">
          <svg className="w-3 h-3 text-green-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="m4.5 15.75 7.5-7.5 7.5 7.5" /></svg>
          <span className="text-[10px] text-green-500 font-medium">-1.1% vs Q1</span>
        </div>
      </div>

      {/* Inclusion Score */}
      <div className="bg-white rounded-xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] text-center">
        <p className="text-[11px] text-[#8B8B8B] mb-1">Indice de Inclusion</p>
        <p className="text-[24px] font-bold text-green-600">82</p>
        <p className="text-[10px] text-[#8B8B8B]">de 100 (encuesta)</p>
        <div className="flex items-center justify-center gap-1 mt-1">
          <svg className="w-3 h-3 text-green-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="m4.5 15.75 7.5-7.5 7.5 7.5" /></svg>
          <span className="text-[10px] text-green-500 font-medium">+5 vs Q1</span>
        </div>
      </div>

      {/* Diverse Hires */}
      <div className="bg-white rounded-xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] text-center">
        <p className="text-[11px] text-[#8B8B8B] mb-1">Contrataciones Diversas</p>
        <p className="text-[24px] font-bold text-[#1F114C]">46%</p>
        <p className="text-[10px] text-[#8B8B8B]">del total Q2</p>
        <div className="flex items-center justify-center gap-1 mt-1">
          <svg className="w-3 h-3 text-green-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="m4.5 15.75 7.5-7.5 7.5 7.5" /></svg>
          <span className="text-[10px] text-green-500 font-medium">+8% vs Q1</span>
        </div>
      </div>
    </div>
  );
}
