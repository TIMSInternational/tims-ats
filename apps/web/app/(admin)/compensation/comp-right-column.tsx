'use client';

const CR_DIST = [
  { label: '< 0.80', pct: 10, count: 4, countLabel: 'subpagados', color: 'bg-[#DD0C15]', textColor: 'text-[#DD0C15]' },
  { label: '0.80 - 0.95', pct: 25, count: 18, countLabel: 'bajo', color: 'bg-amber-400', textColor: 'text-amber-600' },
  { label: '0.95 - 1.05', pct: 50, count: 41, countLabel: 'en meta', color: 'bg-green-500', textColor: 'text-green-600' },
  { label: '1.05 - 1.20', pct: 18, count: 14, countLabel: 'arriba', color: 'bg-blue-400', textColor: 'text-blue-600' },
  { label: '> 1.20', pct: 8, count: 6, countLabel: 'sobre', color: 'bg-amber-500', textColor: 'text-amber-600' },
];

const BENEFITS = [
  { name: 'Seguro Medico', pct: 92, color: 'bg-green-500' },
  { name: 'Plan Dental', pct: 78, color: 'bg-green-500' },
  { name: 'Gimnasio', pct: 45, color: 'bg-amber-400' },
  { name: 'Educacion', pct: 62, color: 'bg-[#1F114C]' },
  { name: 'Alimentacion', pct: 88, color: 'bg-green-500' },
];

const PENDING = [
  { name: 'M. Rodriguez', lastAdj: 'Ene 2025', cr: 0.74, crColor: 'text-[#DD0C15]', action: { cls: 'bg-red-50 text-red-700', label: 'Aumento urgente' } },
  { name: 'L. Fernandez', lastAdj: 'Mar 2025', cr: 0.82, crColor: 'text-amber-600', action: { cls: 'bg-amber-50 text-amber-700', label: 'Revisar banda' } },
  { name: 'C. Vargas', lastAdj: 'Nov 2024', cr: 0.71, crColor: 'text-[#DD0C15]', action: { cls: 'bg-red-50 text-red-700', label: 'Aumento urgente' } },
  { name: 'A. Mendoza', lastAdj: 'Jun 2025', cr: 0.88, crColor: 'text-amber-600', action: { cls: 'bg-amber-50 text-amber-700', label: 'Evaluar promo' } },
  { name: 'J. Castillo', lastAdj: 'Feb 2025', cr: 0.76, crColor: 'text-[#DD0C15]', action: { cls: 'bg-red-50 text-red-700', label: 'Aumento urgente' } },
];

export function CompaRatioDistribution() {
  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
      <div className="text-[13px] font-semibold text-[#333] mb-3">Distribucion Compa-Ratio</div>
      <div className="space-y-2.5">
        {CR_DIST.map((b) => (
          <div key={b.label} className="flex items-center gap-3">
            <div className="w-[80px] text-[10px] text-[#585858] shrink-0">{b.label}</div>
            <div className="flex-1 h-5 bg-[#EDEDED] rounded-full overflow-hidden">
              <div className={`h-full ${b.color} rounded-full`} style={{ width: `${b.pct}%` }} />
            </div>
            <div className="w-[60px] flex items-center gap-1 shrink-0">
              <span className={`text-[11px] font-semibold ${b.textColor}`}>{b.count}</span>
              <span className="text-[9px] text-[#8B8B8B]">{b.countLabel}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BenefitsUtilization() {
  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
      <div className="text-[13px] font-semibold text-[#333] mb-3">Utilizacion de Beneficios</div>
      <div className="space-y-2.5">
        {BENEFITS.map((b) => (
          <div key={b.name}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-[#585858]">{b.name}</span>
              <span className="text-[11px] font-semibold text-[#333]">{b.pct}%</span>
            </div>
            <div className="w-full h-2 bg-[#EDEDED] rounded-full"><div className={`h-full ${b.color} rounded-full`} style={{ width: `${b.pct}%` }} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PendingAdjustments() {
  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[13px] font-semibold text-[#333]">Ajustes Pendientes</div>
        <span className="text-[10px] text-[#DD0C15] font-medium">6 vencidos</span>
      </div>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-[#EDEDED]">
            <th className="text-left text-[#8B8B8B] font-medium pb-2">Empleado</th>
            <th className="text-center text-[#8B8B8B] font-medium pb-2">Ultimo Ajuste</th>
            <th className="text-center text-[#8B8B8B] font-medium pb-2">CR</th>
            <th className="text-left text-[#8B8B8B] font-medium pb-2">Accion</th>
          </tr>
        </thead>
        <tbody className="text-[#333]">
          {PENDING.map((p, i) => (
            <tr key={p.name} className={i < PENDING.length - 1 ? 'border-b border-[#EDEDED]/60' : ''}>
              <td className="py-1.5 font-medium">{p.name}</td>
              <td className="py-1.5 text-center text-[#8B8B8B]">{p.lastAdj}</td>
              <td className="py-1.5 text-center"><span className={`${p.crColor} font-semibold`}>{p.cr.toFixed(2)}</span></td>
              <td className="py-1.5"><span className={`text-[9px] px-1.5 py-0.5 rounded ${p.action.cls}`}>{p.action.label}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
