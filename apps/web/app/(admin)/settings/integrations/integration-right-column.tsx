'use client';

const ERROR_LOG = [
  { name: 'Nomina Colombia - Timeout', status: 'Pendiente', statusCls: 'bg-amber-50 text-amber-600', border: 'border-[#DD0C15]', desc: 'Connection timeout after 30s al sincronizar tabla empleados_co', time: '30 May 13:45', retries: '3/5' },
  { name: 'SAP SF - Rate Limit', status: 'Resuelto', statusCls: 'bg-green-50 text-green-600', border: 'border-amber-400', desc: 'HTTP 429 - Rate limit exceeded. Reintento automatico exitoso.', time: '30 May 11:22', retries: '1/5' },
  { name: 'Google WS - Auth Token Expirado', status: 'Resuelto', statusCls: 'bg-green-50 text-green-600', border: 'border-amber-400', desc: 'OAuth token expired. Refresh automatico completado.', time: '30 May 08:05', retries: '0/5' },
];

const SYNC_ACTIVITY = [
  { time: '14:32', dot: 'bg-green-500', source: 'SAP SF', detail: '1,247 entidades sincronizadas (empleados, puestos)', isError: false },
  { time: '14:30', dot: 'bg-green-500', source: 'Slack', detail: 'Notificaciones enviadas: 8 nuevas entrevistas', isError: false },
  { time: '14:28', dot: 'bg-green-500', source: 'Google WS', detail: '892 cuentas, 23 calendarios actualizados', isError: false },
  { time: '14:25', dot: 'bg-green-500', source: 'AWS SES', detail: '156 emails transaccionales procesados', isError: false },
  { time: '13:45', dot: 'bg-[#DD0C15]', source: 'Nomina CO', detail: 'Error de conexion, reintentando...', isError: true },
  { time: '13:30', dot: 'bg-green-500', source: 'SAP SF', detail: '1,245 entidades sincronizadas', isError: false },
];

const API_KEYS = [
  { key: 'sk_live_****7f3a', env: 'Production', envCls: 'bg-green-50 text-green-600', created: '15 Ene 2026', lastUsed: '30 May 14:32' },
  { key: 'sk_test_****b2d1', env: 'Sandbox', envCls: 'bg-amber-50 text-amber-600', created: '22 Mar 2026', lastUsed: '29 May 16:10' },
];

export function ErrorLog() {
  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 flex flex-col max-h-[195px]">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold text-[#1F114C]">Log de Errores</h3>
        <span className="text-[10px] text-[#8B8B8B]">Ultimas 24h</span>
      </div>
      <div className="flex-1 overflow-y-auto space-y-2">
        {ERROR_LOG.map((e, i) => (
          <div key={i} className={`border-l-2 ${e.border} pl-2.5 py-1`}>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-[#333]">{e.name}</span>
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${e.statusCls}`}>{e.status}</span>
            </div>
            <p className="text-[10px] text-[#8B8B8B] mt-0.5">{e.desc}</p>
            <div className="flex items-center gap-3 mt-1 text-[9px] text-[#8B8B8B]">
              <span>{e.time}</span>
              <span>Reintentos: {e.retries}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SyncActivity() {
  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 flex flex-col max-h-[150px]">
      <h3 className="text-[13px] font-semibold text-[#1F114C] mb-3">Actividad de Sincronizacion</h3>
      <div className="flex-1 overflow-y-auto space-y-2">
        {SYNC_ACTIVITY.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full ${s.dot} shrink-0`} />
            <span className="text-[10px] text-[#8B8B8B] w-[70px] shrink-0">{s.time}</span>
            <span className={`text-[10px] ${s.isError ? 'text-[#DD0C15]' : 'text-[#333]'}`}><strong>{s.source}</strong> -- {s.detail}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ApiKeysPanel() {
  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 flex flex-col max-h-[120px]">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold text-[#1F114C]">API Keys & Sandbox</h3>
        <button className="px-2.5 py-1 rounded-lg text-[10px] font-medium bg-[#F6F6F6] text-[#585858]">+ Generar Key</button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="text-[#8B8B8B] border-b border-[#EDEDED]">
              <th className="text-left pb-1.5 font-medium">API Key</th>
              <th className="text-left pb-1.5 font-medium">Entorno</th>
              <th className="text-left pb-1.5 font-medium">Creada</th>
              <th className="text-left pb-1.5 font-medium">Ultimo Uso</th>
              <th className="text-left pb-1.5 font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody className="text-[#333]">
            {API_KEYS.map((k, i) => (
              <tr key={k.key} className={i < API_KEYS.length - 1 ? 'border-b border-[#F6F6F6]' : ''}>
                <td className="py-1.5 font-mono text-[9px]">{k.key}</td>
                <td className="py-1.5"><span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${k.envCls}`}>{k.env}</span></td>
                <td className="py-1.5 text-[#8B8B8B]">{k.created}</td>
                <td className="py-1.5 text-[#8B8B8B]">{k.lastUsed}</td>
                <td className="py-1.5 flex gap-1">
                  <button className="text-[9px] text-blue-600 hover:underline">Regenerar</button>
                  <button className="text-[9px] text-[#DD0C15] hover:underline">Revocar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
