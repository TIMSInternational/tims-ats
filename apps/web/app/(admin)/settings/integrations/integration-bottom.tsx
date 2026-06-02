'use client';

const AUDIT_ROWS = [
  { who: 'Federico Tafur', action: 'Actualizo credenciales SAP SuccessFactors', when: '30 May 10:15', ip: '192.168.1.45' },
  { who: 'Carlos Mendoza', action: 'Pauso conector Nomina Mexico', when: '29 May 22:00', ip: '10.0.0.112' },
  { who: 'Ana Rodriguez', action: 'Creo webhook interview.scheduled', when: '28 May 15:30', ip: '192.168.1.78' },
  { who: 'Federico Tafur', action: 'Regenero API key produccion (sk_live_****7f3a)', when: '27 May 09:45', ip: '192.168.1.45' },
  { who: 'Maria Lopez', action: 'Configuro frecuencia sync Google WS a 30 min', when: '26 May 14:20', ip: '10.0.0.85' },
];

const HEALTH_ITEMS = [
  { name: 'API Gateway', detail: 'Uptime 99.98%', dot: 'bg-green-500' },
  { name: 'Base de Datos', detail: 'Uptime 99.99%', dot: 'bg-green-500' },
  { name: 'Cola de Mensajes', detail: 'Uptime 99.95%', dot: 'bg-green-500' },
  { name: 'Almacenamiento', detail: '78% usado (warn)', dot: 'bg-amber-400', textColor: 'text-amber-600' },
  { name: 'Workers', detail: '8/8 activos', dot: 'bg-green-500' },
  { name: 'Redis Cache', detail: 'Latencia 2ms', dot: 'bg-green-500' },
];

export function AuditTrail() {
  return (
    <div className="w-[60%] bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 max-h-[155px]">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold text-[#1F114C]">Auditoria de Cambios</h3>
        <span className="text-[10px] text-[#8B8B8B]">Ultimos 7 dias</span>
      </div>
      <div className="overflow-y-auto max-h-[100px]">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="text-[#8B8B8B] border-b border-[#EDEDED]">
              <th className="text-left pb-1.5 font-medium">Quien</th>
              <th className="text-left pb-1.5 font-medium">Accion</th>
              <th className="text-left pb-1.5 font-medium">Cuando</th>
              <th className="text-left pb-1.5 font-medium">IP</th>
            </tr>
          </thead>
          <tbody className="text-[#333]">
            {AUDIT_ROWS.map((a, i) => (
              <tr key={i} className={i < AUDIT_ROWS.length - 1 ? 'border-b border-[#F6F6F6]' : ''}>
                <td className="py-1.5 font-medium">{a.who}</td>
                <td className="py-1.5">{a.action}</td>
                <td className="py-1.5 text-[#8B8B8B]">{a.when}</td>
                <td className="py-1.5 font-mono text-[9px] text-[#8B8B8B]">{a.ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SystemHealth() {
  return (
    <div className="w-[40%] bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 max-h-[155px]">
      <h3 className="text-[13px] font-semibold text-[#1F114C] mb-3">Salud del Sistema</h3>
      <div className="grid grid-cols-2 gap-3">
        {HEALTH_ITEMS.map((h) => (
          <div key={h.name} className="flex items-center gap-2.5">
            <div className={`w-2.5 h-2.5 rounded-full ${h.dot}`} />
            <div>
              <p className="text-[11px] font-medium text-[#333]">{h.name}</p>
              <p className={`text-[10px] ${h.textColor ?? 'text-[#8B8B8B]'}`}>{h.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
