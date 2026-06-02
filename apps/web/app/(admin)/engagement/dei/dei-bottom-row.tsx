'use client';

const PROMOTION_DATA = [
  { dept: 'Tecnologia', m: '14%', f: '11%', gap: '-3%', color: 'text-amber-500' },
  { dept: 'Operaciones', m: '12%', f: '13%', gap: '+1%', color: 'text-green-600' },
  { dept: 'RRHH', m: '10%', f: '15%', gap: '+5%', color: 'text-green-600' },
  { dept: 'Finanzas', m: '11%', f: '9%', gap: '-2%', color: 'text-amber-500' },
  { dept: 'Comercial', m: '13%', f: '12%', gap: '-1%', color: 'text-green-600' },
];

const INCLUSION_TREND = [
  { quarter: "Q3 '25", score: 72, height: 52, color: '#E8E5F0', textColor: 'text-[#1F114C]' },
  { quarter: "Q4 '25", score: 75, height: 58, color: '#D4CFE5', textColor: 'text-[#1F114C]' },
  { quarter: "Q1 '26", score: 77, height: 62, color: '#B8AED4', textColor: 'text-[#1F114C]' },
  { quarter: "Q2 '26", score: 82, height: 72, color: '#1F114C', textColor: 'text-green-600' },
];

export function PromotionEquity() {
  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h3 className="text-[13px] font-semibold text-[#1F114C] mb-3">Equidad en Promociones</h3>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-[#8B8B8B] border-b border-[#EDEDED]">
            <th className="text-left py-1.5 font-medium">Depto</th>
            <th className="text-center py-1.5 font-medium">Masc</th>
            <th className="text-center py-1.5 font-medium">Fem</th>
            <th className="text-center py-1.5 font-medium">Gap</th>
          </tr>
        </thead>
        <tbody className="text-[#333]">
          {PROMOTION_DATA.map((r, i) => (
            <tr key={r.dept} className={i < PROMOTION_DATA.length - 1 ? 'border-b border-[#F6F6F6]' : ''}>
              <td className="py-1.5">{r.dept}</td>
              <td className="text-center py-1.5">{r.m}</td>
              <td className="text-center py-1.5">{r.f}</td>
              <td className="text-center py-1.5"><span className={`${r.color} font-medium`}>{r.gap}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[10px] text-[#8B8B8B] mt-2">Tasa de promocion ultimo 12 meses</p>
    </div>
  );
}

export function LeadershipDiversity() {
  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h3 className="text-[13px] font-semibold text-[#1F114C] mb-3">Diversidad en Liderazgo</h3>
      <div className="flex items-center gap-4">
        <div className="shrink-0">
          <svg width="100" height="100" viewBox="0 0 42 42">
            <circle cx="21" cy="21" r="15.9" fill="transparent" stroke="#3B82F6" strokeWidth="6" strokeDasharray="62 38" strokeDashoffset="25" />
            <circle cx="21" cy="21" r="15.9" fill="transparent" stroke="#EC4899" strokeWidth="6" strokeDasharray="32 68" strokeDashoffset="63" />
            <circle cx="21" cy="21" r="15.9" fill="transparent" stroke="#A78BFA" strokeWidth="6" strokeDasharray="6 94" strokeDashoffset="31" />
            <text x="21" y="22" textAnchor="middle" fill="#1F114C" fontSize="5" fontWeight="700">18</text>
            <text x="21" y="26" textAnchor="middle" fill="#8B8B8B" fontSize="3">lideres</text>
          </svg>
        </div>
        <div className="flex-1 space-y-2">
          {[
            { label: 'Hombres', pct: '62%', dot: 'bg-blue-500' },
            { label: 'Mujeres', pct: '32%', dot: 'bg-pink-500' },
            { label: 'No-Binario', pct: '6%', dot: 'bg-purple-400' },
          ].map((r) => (
            <div key={r.label} className="flex items-center justify-between">
              <div className="flex items-center gap-1.5"><div className={`w-2.5 h-2.5 rounded-sm ${r.dot}`} /><span className="text-[11px] text-[#333]">{r.label}</span></div>
              <span className="text-[11px] font-semibold text-[#1F114C]">{r.pct}</span>
            </div>
          ))}
          <div className="pt-1 border-t border-[#F0F0F0]">
            <p className="text-[10px] text-[#8B8B8B]">Meta 2026: <strong className="text-[#1F114C]">40% mujeres</strong></p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function InclusionTrend() {
  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h3 className="text-[13px] font-semibold text-[#1F114C] mb-3">Tendencia Indice de Inclusion</h3>
      <div className="flex items-end justify-between gap-3 h-[80px] px-2">
        {INCLUSION_TREND.map((q) => (
          <div key={q.quarter} className="flex flex-col items-center gap-1 flex-1">
            <span className={`text-[11px] font-semibold ${q.textColor}`}>{q.score}</span>
            <div className="w-full rounded-t" style={{ height: `${q.height}px`, backgroundColor: q.color }} />
            <span className="text-[10px] text-[#8B8B8B]">{q.quarter}</span>
          </div>
        ))}
      </div>
      <div className="flex justify-between items-center mt-3 pt-2 border-t border-[#F0F0F0]">
        <span className="text-[10px] text-[#8B8B8B]">Crecimiento: <strong className="text-green-600">+10 pts</strong> (4 trimestres)</span>
        <span className="text-[10px] text-[#8B8B8B]">Meta: <strong className="text-[#1F114C]">85</strong></span>
      </div>
    </div>
  );
}
