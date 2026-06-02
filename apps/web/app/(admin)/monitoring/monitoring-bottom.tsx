'use client';

export function CrossModuleTrend() {
  return (
    <div className="flex-1 bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4 flex flex-col min-w-0">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[13px] font-semibold text-[#333]">Tendencia Cross-Modulo (6 Meses)</span>
        <div className="flex items-center gap-3">
          {[
            { color: 'bg-[#1F114C]', label: 'Headcount' },
            { color: 'bg-[#DD0C15]', label: 'Rotacion %' },
            { color: 'bg-green-500', label: 'eNPS' },
            { color: 'bg-amber-500', label: 'Time-to-Fill' },
          ].map((l) => (
            <div key={l.label} className="flex items-center gap-1">
              <div className={`w-2 h-2 rounded-full ${l.color}`} />
              <span className="text-[9px] text-[#8B8B8B]">{l.label}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="flex-1 relative">
        <svg className="w-full h-full" viewBox="0 0 700 90" preserveAspectRatio="none">
          {[0, 22, 45, 67, 89].map((y) => (
            <line key={y} x1="0" y1={y} x2="700" y2={y} stroke="#f0f0f0" strokeWidth="0.5" />
          ))}
          {/* Bars for each month */}
          {[
            { x: 20, op: 0.15 }, { x: 140, op: 0.2 }, { x: 260, op: 0.25 },
            { x: 380, op: 0.35 }, { x: 500, op: 0.5 }, { x: 620, op: 1 },
          ].map((m, mi) => (
            <g key={mi}>
              <rect x={m.x} y={30 - mi * 3} width="20" height={59 + mi * 3} rx="2" fill="#1F114C" opacity={m.op} />
              <rect x={m.x + 22} y={50 - mi * 3} width="20" height={39 + mi * 3} rx="2" fill="#DD0C15" opacity={m.op} />
              <rect x={m.x + 44} y={35 - mi * 3} width="20" height={54 + mi * 3} rx="2" fill="#22c55e" opacity={m.op} />
              <rect x={m.x + 66} y={40 - mi * 3} width={mi === 5 ? 14 : 20} height={49 + mi * 3} rx="2" fill="#f59e0b" opacity={m.op} />
            </g>
          ))}
        </svg>
        <div className="absolute bottom-[-14px] left-0 right-0 flex justify-between px-4">
          {['Dic', 'Ene', 'Feb', 'Mar', 'Abr', 'May'].map((m, i) => (
            <span key={m} className={`text-[9px] text-[#8B8B8B] ${i === 5 ? 'font-semibold' : ''}`}>{m}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function QuickActions() {
  const actions = [
    { icon: <svg className="w-3.5 h-3.5 text-[#DD0C15]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" /></svg>, bg: 'bg-red-50', title: 'Ver Vacantes Criticas', sub: '5 vacantes con SLA vencido' },
    { icon: <svg className="w-3.5 h-3.5 text-amber-500" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" /></svg>, bg: 'bg-amber-50', title: 'Revisar Alertas', sub: '7 alertas pendientes' },
    { icon: <svg className="w-3.5 h-3.5 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>, bg: 'bg-[#1F114C]/5', title: 'Exportar Reporte Ejecutivo', sub: 'PDF con KPIs del mes' },
  ];

  return (
    <div className="w-[310px] shrink-0 bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4 flex flex-col">
      <span className="text-[13px] font-semibold text-[#333] mb-3">Acciones Rapidas</span>
      <div className="flex flex-col gap-2 flex-1">
        {actions.map((a) => (
          <button key={a.title} className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg border border-[#EDEDED] hover:bg-[#F6F6F6] transition text-left">
            <div className={`w-7 h-7 rounded-lg ${a.bg} flex items-center justify-center shrink-0`}>{a.icon}</div>
            <div>
              <p className="text-[11px] font-medium text-[#333]">{a.title}</p>
              <p className="text-[9px] text-[#8B8B8B]">{a.sub}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
