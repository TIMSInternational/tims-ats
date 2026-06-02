'use client';

const ACTION_STATUS: Record<string, { cls: string; label: string }> = {
  in_progress: { cls: 'text-blue-600 bg-blue-50', label: 'En progreso' },
  pending: { cls: 'text-amber-600 bg-amber-50', label: 'Pendiente' },
  completed: { cls: 'text-green-600 bg-green-50', label: 'Completado' },
};

const MOCK_PLANS = [
  { plan: 'Programa de reconocimiento Ops', resp: 'Carlos Mendoza', area: 'Operaciones', status: 'in_progress', due: '15 Jun 2026' },
  { plan: 'Encuesta pulso semanal Ventas', resp: 'Ana Patricia Reyes', area: 'Ventas', status: 'pending', due: '01 Jul 2026' },
  { plan: 'Taller liderazgo situacional', resp: 'Roberto Villalobos', area: 'Operaciones', status: 'in_progress', due: '20 Jun 2026' },
  { plan: 'Rediseno espacios comunes', resp: 'Lucia Fernandez', area: 'RRHH', status: 'completed', due: '10 May 2026' },
];

const MOCK_COMMITMENTS = [
  { initials: 'CM', name: 'Carlos Mendoza', task: 'Reuniones 1:1 semanales con cada operador', status: 'in_progress', date: 'Desde 20 May', color: 'bg-[#1F114C]' },
  { initials: 'AR', name: 'Ana Patricia Reyes', task: 'Implementar bonos trimestrales por desempeno', status: 'pending', date: 'Fecha: 01 Jul', color: 'bg-[#DD0C15]' },
  { initials: 'RV', name: 'Roberto Villalobos', task: 'Reducir horas extra en area de despacho', status: 'completed', date: 'Cerrado 12 May', color: 'bg-[#22c55e]' },
  { initials: 'LF', name: 'Lucia Fernandez', task: 'Crear programa de mentoria para nuevos ingresos', status: 'in_progress', date: 'Desde 05 May', color: 'bg-[#1F114C]' },
];

export function ActionPlans() {
  return (
    <div className="w-[55%] bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold text-[#333]">Planes de Accion</h3>
        <button className="text-[10px] text-[#DD0C15] font-medium">+ Nuevo Plan</button>
      </div>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-[#EDEDED]">
            <th className="text-left font-medium text-[#8B8B8B] pb-2">Plan</th>
            <th className="text-left font-medium text-[#8B8B8B] pb-2">Responsable</th>
            <th className="text-left font-medium text-[#8B8B8B] pb-2">Area</th>
            <th className="text-left font-medium text-[#8B8B8B] pb-2">Estado</th>
            <th className="text-left font-medium text-[#8B8B8B] pb-2">Vencimiento</th>
          </tr>
        </thead>
        <tbody>
          {MOCK_PLANS.map((p, i) => {
            const st = ACTION_STATUS[p.status] ?? ACTION_STATUS.pending;
            return (
              <tr key={i} className={i < MOCK_PLANS.length - 1 ? 'border-b border-[#F6F6F6]' : ''}>
                <td className="py-2 text-[#333] font-medium">{p.plan}</td>
                <td className="py-2 text-[#585858]">{p.resp}</td>
                <td className="py-2 text-[#585858]">{p.area}</td>
                <td className="py-2"><span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span></td>
                <td className="py-2 text-[#585858]">{p.due}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function LeaderCommitments() {
  return (
    <div className="w-[45%] bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold text-[#333]">Compromisos del Lider</h3>
        <span className="text-[10px] text-[#8B8B8B]">Ultimo trimestre</span>
      </div>
      <div className="space-y-2.5">
        {MOCK_COMMITMENTS.map((c, i) => {
          const st = ACTION_STATUS[c.status] ?? ACTION_STATUS.pending;
          return (
            <div key={i} className="flex items-start gap-3 p-2.5 bg-[#F6F6F6] rounded-lg">
              <div className={`w-7 h-7 rounded-full ${c.color} flex items-center justify-center text-white text-[9px] font-bold shrink-0`}>
                {c.initials}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-medium text-[#333]">{c.name}</p>
                <p className="text-[10px] text-[#585858]">{c.task}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${st.cls}`}>{st.label}</span>
                  <span className="text-[9px] text-[#8B8B8B]">{c.date}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
