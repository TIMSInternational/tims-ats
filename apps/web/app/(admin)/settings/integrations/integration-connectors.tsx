'use client';

const CONNECTORS = [
  { abbr: 'SAP', name: 'SAP SuccessFactors', status: 'Activo', statusCls: 'bg-green-50 text-green-600', abbrBg: 'bg-blue-100 text-blue-700', lastSync: '30 May 14:32', entities: '1,247 entidades', freq: 'Cada 15 min', btnLabel: 'Sync Now', btnCls: 'bg-[#1F114C] text-white' },
  { abbr: 'G', name: 'Google Workspace', status: 'Activo', statusCls: 'bg-green-50 text-green-600', abbrBg: 'bg-red-50 text-red-600', lastSync: '30 May 14:28', entities: '892 entidades', freq: 'Cada 30 min', btnLabel: 'Sync Now', btnCls: 'bg-[#1F114C] text-white' },
  { abbr: 'SL', name: 'Slack', status: 'Activo', statusCls: 'bg-green-50 text-green-600', abbrBg: 'bg-purple-50 text-purple-600', lastSync: '30 May 14:30', entities: '45 canales', freq: 'Tiempo real', btnLabel: 'Sync Now', btnCls: 'bg-[#1F114C] text-white' },
  { abbr: 'AWS', name: 'AWS SES', status: 'Activo', statusCls: 'bg-green-50 text-green-600', abbrBg: 'bg-amber-50 text-amber-700', lastSync: '30 May 14:25', entities: '3,480 emails', freq: 'Cada 5 min', btnLabel: 'Sync Now', btnCls: 'bg-[#1F114C] text-white' },
  { abbr: 'CO', name: 'Nomina Colombia', status: 'Error', statusCls: 'bg-red-50 text-[#DD0C15]', abbrBg: 'bg-yellow-50 text-yellow-700', lastSync: '30 May 13:45', entities: '568 empleados', freq: 'Cada 1h', btnLabel: 'Reintentar', btnCls: 'bg-[#DD0C15] text-white' },
  { abbr: 'MX', name: 'Nomina Mexico', status: 'Pausado', statusCls: 'bg-amber-50 text-amber-600', abbrBg: 'bg-green-50 text-green-700', lastSync: '29 May 22:00', entities: '312 empleados', freq: 'Cada 1h (pausado)', btnLabel: 'Reanudar', btnCls: 'bg-green-600 text-white' },
];

export function ActiveConnectors() {
  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 flex flex-col max-h-[280px]">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold text-[#1F114C]">Conectores Activos</h3>
        <input type="text" placeholder="Buscar conector..." className="border border-[#EDEDED] rounded-lg px-2.5 h-7 text-[11px] w-[140px] outline-none focus:border-[#1F114C]" />
      </div>
      <div className="flex-1 overflow-y-auto space-y-2">
        {CONNECTORS.map((c) => (
          <div key={c.name} className="border border-[#EDEDED] rounded-lg p-2.5 hover:border-[#1F114C]/20">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <div className={`w-7 h-7 rounded ${c.abbrBg} flex items-center justify-center`}>
                  <span className="text-[10px] font-bold">{c.abbr}</span>
                </div>
                <div>
                  <span className="text-[12px] font-medium text-[#333]">{c.name}</span>
                  <span className={`ml-2 px-1.5 py-0.5 rounded text-[9px] font-medium ${c.statusCls}`}>{c.status}</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button className={`px-2 py-1 rounded text-[9px] font-medium ${c.btnCls}`}>{c.btnLabel}</button>
                <button className="px-2 py-1 rounded text-[9px] font-medium border border-[#EDEDED] text-[#585858]">Config</button>
                {c.status !== 'Pausado' && (
                  <button className="px-2 py-1 rounded text-[9px] font-medium border border-[#EDEDED] text-amber-600">Pausar</button>
                )}
              </div>
            </div>
            <div className="flex items-center gap-4 text-[10px] text-[#8B8B8B]">
              <span>Ultimo sync: {c.lastSync}</span>
              <span>{c.entities}</span>
              <span>{c.freq}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const WEBHOOKS = [
  { endpoint: 'https://api.tims.co/wh/****a3f2', events: 'candidate.created, candidate.updated', status: 'Activo', statusCls: 'bg-green-50 text-green-600', lastTrigger: '30 May 14:31' },
  { endpoint: 'https://api.tims.co/wh/****b7e1', events: 'offer.approved, offer.rejected', status: 'Activo', statusCls: 'bg-green-50 text-green-600', lastTrigger: '30 May 13:15' },
  { endpoint: 'https://slack.tims.co/wh/****d4c9', events: 'interview.scheduled, interview.completed', status: 'Activo', statusCls: 'bg-green-50 text-green-600', lastTrigger: '30 May 14:28' },
  { endpoint: 'https://nomina.tims.co/wh/****e5a8', events: 'employee.onboarded, payroll.sync', status: 'Pausado', statusCls: 'bg-amber-50 text-amber-600', lastTrigger: '29 May 22:00' },
];

export function WebhooksConfig() {
  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 flex flex-col max-h-[175px]">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold text-[#1F114C]">Configuracion de Webhooks</h3>
        <button className="px-2.5 py-1 rounded-lg text-[10px] font-medium bg-[#F6F6F6] text-[#585858]">+ Agregar Webhook</button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="text-[#8B8B8B] border-b border-[#EDEDED]">
              <th className="text-left pb-2 font-medium">Endpoint</th>
              <th className="text-left pb-2 font-medium">Eventos</th>
              <th className="text-left pb-2 font-medium">Estado</th>
              <th className="text-left pb-2 font-medium">Ultimo Trigger</th>
            </tr>
          </thead>
          <tbody className="text-[#333]">
            {WEBHOOKS.map((w, i) => (
              <tr key={i} className={i < WEBHOOKS.length - 1 ? 'border-b border-[#F6F6F6]' : ''}>
                <td className="py-1.5 font-mono text-[9px]">{w.endpoint}</td>
                <td className="py-1.5">{w.events}</td>
                <td className="py-1.5"><span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${w.statusCls}`}>{w.status}</span></td>
                <td className="py-1.5 text-[#8B8B8B]">{w.lastTrigger}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
