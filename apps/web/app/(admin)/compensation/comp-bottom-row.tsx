'use client';

const MARKET_ROLES = [
  { role: 'Analista Logistica', pos: 55, label: 'P55', dot: 'bg-[#1F114C]', text: 'text-[#333]' },
  { role: 'Coord. Comercial', pos: 68, label: 'P68', dot: 'bg-green-500', text: 'text-green-600' },
  { role: 'Sup. Operaciones', pos: 32, label: 'P32', dot: 'bg-[#DD0C15]', text: 'text-[#DD0C15]' },
  { role: 'Gerente de Ventas', pos: 72, label: 'P72', dot: 'bg-green-500', text: 'text-green-600' },
  { role: 'Director Logistica', pos: 60, label: 'P60', dot: 'bg-[#1F114C]', text: 'text-[#333]' },
  { role: 'Esp. RRHH', pos: 42, label: 'P42', dot: 'bg-amber-400', text: 'text-amber-600' },
];

const COMP_BREAKDOWN = [
  { level: 'Junior', total: '$1,520/mes', base: 78, variable: 8, benefits: 14 },
  { level: 'Mid', total: '$2,860/mes', base: 72, variable: 12, benefits: 16 },
  { level: 'Senior', total: '$4,650/mes', base: 65, variable: 18, benefits: 17 },
  { level: 'Lead', total: '$7,200/mes', base: 60, variable: 22, benefits: 18 },
  { level: 'Director', total: '$12,400/mes', base: 55, variable: 28, benefits: 17 },
];

export function MarketCompetitiveness() {
  return (
    <div className="col-span-7 bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[13px] font-semibold text-[#333]">Competitividad vs Mercado</div>
        <span className="text-[10px] text-[#8B8B8B]">Percentil salarial TIMS vs mercado</span>
      </div>
      <div className="space-y-2.5">
        {MARKET_ROLES.map((r) => (
          <div key={r.role} className="flex items-center gap-3">
            <div className="w-[140px] text-[10px] text-[#585858] shrink-0 truncate">{r.role}</div>
            <div className="flex-1 relative h-4 bg-[#EDEDED] rounded-full">
              <div className="absolute left-1/2 top-0 bottom-0 w-px bg-[#8B8B8B]/40" />
              <div className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full ${r.dot} border-2 border-white shadow`} style={{ left: `${r.pos}%` }} />
            </div>
            <div className={`w-[40px] text-[10px] font-semibold ${r.text} shrink-0 text-right`}>{r.label}</div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-4 mt-3 pt-3 border-t border-[#EDEDED]">
        <div className="flex items-center gap-1.5 text-[9px] text-[#8B8B8B]"><div className="w-2 h-2 rounded-full bg-[#DD0C15]" /> &lt; P40 (bajo)</div>
        <div className="flex items-center gap-1.5 text-[9px] text-[#8B8B8B]"><div className="w-2 h-2 rounded-full bg-amber-400" /> P40-P50</div>
        <div className="flex items-center gap-1.5 text-[9px] text-[#8B8B8B]"><div className="w-2 h-2 rounded-full bg-[#1F114C]" /> P50-P65</div>
        <div className="flex items-center gap-1.5 text-[9px] text-[#8B8B8B]"><div className="w-2 h-2 rounded-full bg-green-500" /> &gt; P65 (competitivo)</div>
        <div className="flex items-center gap-1.5 text-[9px] text-[#8B8B8B]"><div className="w-px h-3 bg-[#8B8B8B]/40" /> Mediana mercado</div>
      </div>
    </div>
  );
}

export function TotalCompBreakdown() {
  return (
    <div className="col-span-5 bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
      <div className="text-[13px] font-semibold text-[#333] mb-3">Composicion Compensacion Total</div>
      <div className="space-y-3">
        {COMP_BREAKDOWN.map((c) => (
          <div key={c.level}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-[#585858] font-medium">{c.level}</span>
              <span className="text-[10px] text-[#8B8B8B]">{c.total}</span>
            </div>
            <div className="flex h-4 rounded-full overflow-hidden">
              <div className="bg-[#1F114C] h-full" style={{ width: `${c.base}%` }} />
              <div className="bg-[#DD0C15] h-full" style={{ width: `${c.variable}%` }} />
              <div className="bg-amber-400 h-full" style={{ width: `${c.benefits}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-4 mt-3 pt-3 border-t border-[#EDEDED]">
        <div className="flex items-center gap-1.5 text-[9px] text-[#8B8B8B]"><div className="w-3 h-2 rounded bg-[#1F114C]" /> Salario Base</div>
        <div className="flex items-center gap-1.5 text-[9px] text-[#8B8B8B]"><div className="w-3 h-2 rounded bg-[#DD0C15]" /> Variable</div>
        <div className="flex items-center gap-1.5 text-[9px] text-[#8B8B8B]"><div className="w-3 h-2 rounded bg-amber-400" /> Beneficios</div>
      </div>
    </div>
  );
}
