'use client';

const ALERTS = [
  { severity: 'Critico', sevCls: 'bg-[#DD0C15]', module: 'Reclutamiento', msg: 'SLA vencido en 3 vacantes criticas', time: 'Hace 12 min', border: 'border-red-200 bg-red-50/50' },
  { severity: 'Critico', sevCls: 'bg-[#DD0C15]', module: 'Sucesion', msg: '2 roles criticos sin sucesor identificado', time: 'Hace 45 min', border: 'border-red-200 bg-red-50/50' },
  { severity: 'Alto', sevCls: 'bg-amber-500', module: 'Engagement', msg: 'eNPS bajo en Ventas (score: 12)', time: 'Hace 1 hora', border: 'border-amber-200 bg-amber-50/50' },
  { severity: 'Alto', sevCls: 'bg-amber-500', module: 'Onboarding', msg: 'Juan Perez onboarding en riesgo - dia 47 sin completar modulo 3', time: 'Hace 2 horas', border: 'border-amber-200 bg-amber-50/50' },
  { severity: 'Alto', sevCls: 'bg-amber-500', module: 'Performance', msg: '14 evaluaciones vencen en 5 dias - Depto. Logistica', time: 'Hace 3 horas', border: 'border-amber-200 bg-amber-50/50' },
  { severity: 'Medio', sevCls: 'bg-blue-500', module: 'L&D', msg: 'Certificacion ISO 9001 vence para 8 empleados en 30 dias', time: 'Hace 4 horas', border: 'border-blue-200 bg-blue-50/50' },
  { severity: 'Medio', sevCls: 'bg-blue-500', module: 'Rotacion', msg: 'Rotacion en Operaciones supero umbral trimestral (11.3%)', time: 'Hace 6 horas', border: 'border-blue-200 bg-blue-50/50' },
];

export function AlertsPanel() {
  return (
    <div className="w-[310px] shrink-0 bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#EDEDED]">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-[#DD0C15]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
          </svg>
          <span className="text-[13px] font-semibold text-[#333]">Alertas Activas</span>
        </div>
        <span className="text-[10px] bg-[#DD0C15] text-white px-1.5 py-0.5 rounded-full font-bold">7</span>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {ALERTS.map((a, i) => (
          <div key={i} className={`border rounded-lg p-3 ${a.border}`}>
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-[9px] font-bold ${a.sevCls} text-white px-1.5 py-0.5 rounded uppercase`}>{a.severity}</span>
              <span className="text-[9px] bg-[#1F114C] text-white px-1.5 py-0.5 rounded">{a.module}</span>
            </div>
            <p className="text-[11px] text-[#333] font-medium leading-tight">{a.msg}</p>
            <p className="text-[9px] text-[#8B8B8B] mt-1">{a.time}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
