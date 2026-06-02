'use client';

const BAND_LEVELS = [
  { level: 'Director', range: ['$6,500', '$8,500', '$10,500'], dots: [
    { pos: 45, outlier: false }, { pos: 62, outlier: false }, { pos: 92, outlier: true },
  ]},
  { level: 'Lead', range: ['$4,500', '$6,000', '$7,500'], dots: [
    { pos: 30, outlier: false }, { pos: 52, outlier: false }, { pos: 65, outlier: false }, { pos: 5, outlier: true },
  ]},
  { level: 'Senior', range: ['$3,000', '$4,000', '$5,000'], dots: [
    { pos: 25, outlier: false }, { pos: 40, outlier: false }, { pos: 55, outlier: false }, { pos: 70, outlier: false }, { pos: 48, outlier: false },
  ]},
  { level: 'Mid', range: ['$1,600', '$2,300', '$3,000'], dots: [
    { pos: 20, outlier: false }, { pos: 35, outlier: false }, { pos: 50, outlier: false }, { pos: 60, outlier: false }, { pos: 42, outlier: false }, { pos: 75, outlier: false },
  ]},
  { level: 'Junior', range: ['$900', '$1,250', '$1,600'], dots: [
    { pos: 22, outlier: false }, { pos: 38, outlier: false }, { pos: 55, outlier: false }, { pos: 95, outlier: true },
  ]},
];

const EQUITY_ROWS = [
  { role: 'Analista Logistica', m: '$2,450', f: '$2,380', gap: '-2.9%', gapColor: 'text-amber-600', badge: { cls: 'bg-amber-50 text-amber-700', label: 'Revisar' } },
  { role: 'Coordinador Comercial', m: '$3,800', f: '$3,750', gap: '-1.3%', gapColor: 'text-green-600', badge: { cls: 'bg-green-50 text-green-700', label: 'OK' } },
  { role: 'Supervisor Operaciones', m: '$4,200', f: '$3,850', gap: '-8.3%', gapColor: 'text-[#DD0C15]', badge: { cls: 'bg-red-50 text-red-700', label: 'Critico' } },
  { role: 'Especialista RRHH', m: '$3,100', f: '$3,050', gap: '-1.6%', gapColor: 'text-green-600', badge: { cls: 'bg-green-50 text-green-700', label: 'OK' } },
  { role: 'Gerente de Ventas', m: '$6,800', f: '$6,200', gap: '-8.8%', gapColor: 'text-[#DD0C15]', badge: { cls: 'bg-red-50 text-red-700', label: 'Critico' } },
];

export function SalaryBands() {
  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="text-[13px] font-semibold text-[#333]">Bandas Salariales por Nivel</div>
        <span className="text-[10px] text-[#8B8B8B]">USD mensual</span>
      </div>
      <div className="space-y-3">
        {BAND_LEVELS.map((b) => (
          <div key={b.level} className="flex items-center gap-3">
            <div className="w-[72px] text-[11px] font-medium text-[#585858] shrink-0">{b.level}</div>
            <div className="flex-1 relative h-6">
              <div className="absolute inset-y-0 rounded bg-[#1F114C]/10" style={{ left: '0%', right: '0%' }} />
              <div className="absolute top-1 bottom-1 rounded bg-[#1F114C]/30" style={{ left: '10%', right: '10%' }} />
              {b.dots.map((d, i) => (
                <div
                  key={i}
                  className={`absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border-2 border-white shadow ${d.outlier ? 'bg-[#DD0C15]' : 'bg-[#1F114C]'}`}
                  style={{ left: `${d.pos}%` }}
                />
              ))}
            </div>
            <div className="flex gap-3 text-[9px] text-[#8B8B8B] shrink-0 w-[120px]">
              {b.range.map((r, i) => <span key={i}>{r}</span>)}
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-4 mt-3 pt-3 border-t border-[#EDEDED]">
        <div className="flex items-center gap-1.5 text-[10px] text-[#8B8B8B]"><div className="w-2 h-2 rounded-full bg-[#1F114C]" /> Dentro de banda</div>
        <div className="flex items-center gap-1.5 text-[10px] text-[#8B8B8B]"><div className="w-2 h-2 rounded-full bg-[#DD0C15]" /> Fuera de banda</div>
        <div className="flex items-center gap-1.5 text-[10px] text-[#8B8B8B]"><div className="w-3 h-2 rounded bg-[#1F114C]/10" /> Rango min-max</div>
        <div className="flex items-center gap-1.5 text-[10px] text-[#8B8B8B]"><div className="w-3 h-2 rounded bg-[#1F114C]/30" /> Rango IQR</div>
      </div>
    </div>
  );
}

export function PayEquityCard() {
  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[13px] font-semibold text-[#333]">Equidad Salarial por Rol y Genero</div>
        <span className="text-[10px] px-2 py-0.5 rounded bg-amber-50 text-amber-700 font-medium">3 brechas detectadas</span>
      </div>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-[#EDEDED]">
            <th className="text-left text-[#8B8B8B] font-medium pb-2 pr-3">Rol</th>
            <th className="text-right text-[#8B8B8B] font-medium pb-2 px-2">Hombres</th>
            <th className="text-right text-[#8B8B8B] font-medium pb-2 px-2">Mujeres</th>
            <th className="text-right text-[#8B8B8B] font-medium pb-2 px-2">Brecha</th>
            <th className="text-center text-[#8B8B8B] font-medium pb-2 pl-2">Estado</th>
          </tr>
        </thead>
        <tbody className="text-[#333]">
          {EQUITY_ROWS.map((r, i) => (
            <tr key={r.role} className={i < EQUITY_ROWS.length - 1 ? 'border-b border-[#EDEDED]/60' : ''}>
              <td className="py-2 pr-3 font-medium">{r.role}</td>
              <td className="py-2 px-2 text-right">{r.m}</td>
              <td className="py-2 px-2 text-right">{r.f}</td>
              <td className={`py-2 px-2 text-right ${r.gapColor} font-medium`}>{r.gap}</td>
              <td className="py-2 pl-2 text-center"><span className={`text-[9px] px-1.5 py-0.5 rounded ${r.badge.cls}`}>{r.badge.label}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
