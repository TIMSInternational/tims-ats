'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';

export default function SupportPage() {
  const [newEmail, setNewEmail] = useState('');
  const [resetEmail, setResetEmail] = useState('');
  const [notifOrg, setNotifOrg] = useState('');
  const [notifMessage, setNotifMessage] = useState('');
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const utils = trpc.useUtils();

  const { data: emailsData, isLoading: emailsLoading } = trpc.platform.listPlatformOwnerEmails.useQuery();

  const addEmailMutation = trpc.platform.addPlatformOwnerEmail.useMutation({
    onSuccess: () => {
      setNewEmail('');
      utils.platform.listPlatformOwnerEmails.invalidate();
      toast('Email agregado exitosamente', { type: 'success' });
    },
    onError: (err) => { toast(err.message || 'Error al agregar email', { type: 'error' }); },
  });

  const removeEmailMutation = trpc.platform.removePlatformOwnerEmail.useMutation({
    onSuccess: () => {
      setConfirmRemove(null);
      utils.platform.listPlatformOwnerEmails.invalidate();
      toast('Email eliminado', { type: 'success' });
    },
    onError: (err) => { toast(err.message || 'Error al eliminar email', { type: 'error' }); },
  });

  const emails = emailsData ?? [];

  function handleAddEmail(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newEmail.trim();
    if (!trimmed || !trimmed.includes('@')) return;
    addEmailMutation.mutate({ email: trimmed });
  }

  function handleRemoveEmail(email: string) {
    if (confirmRemove === email) {
      removeEmailMutation.mutate({ email });
    } else {
      setConfirmRemove(email);
    }
  }

  return (
    <main className="flex-1 overflow-y-auto p-6 space-y-5">
      {/* Top Row: Three Columns */}
      <div className="grid grid-cols-3 gap-5">
        {/* Column 1: Platform Owner Emails */}
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
          <h3 className="text-sm font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <svg className="w-4 h-4 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
            </svg>
            Emails Platform Owner
          </h3>

          {/* Add Email Form */}
          <form onSubmit={handleAddEmail} className="mb-4">
            <div className="flex gap-2">
              <input
                type="email"
                placeholder="nuevo@email.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="flex-1 border border-[#EDEDED] rounded-lg px-3 py-2.5 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-[#1F114C]/20 focus:border-[#1F114C]/30"
              />
              <button
                type="submit"
                disabled={addEmailMutation.isPending || !newEmail.trim()}
                className="px-3 py-2 bg-[#1F114C] text-white rounded-lg text-sm font-medium hover:bg-[#2D1B69] whitespace-nowrap disabled:opacity-50"
              >
                {addEmailMutation.isPending ? '...' : 'Agregar'}
              </button>
            </div>
            {addEmailMutation.error && (
              <p className="text-xs text-red-500 mt-1">{addEmailMutation.error.message}</p>
            )}
          </form>

          {/* Email List */}
          <div className="text-[11px] text-gray-400 uppercase tracking-wide mb-2">Whitelist Actual</div>
          {emailsLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-10 bg-gray-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : emails.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-sm text-gray-400">No hay emails registrados</p>
              <p className="text-xs text-gray-300 mt-1">Agrega un email para comenzar</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[280px] overflow-y-auto">
              {emails.map((item) => {
                const email = typeof item === 'string' ? item : item.email;
                const isConfirming = confirmRemove === email;
                return (
                  <div
                    key={email}
                    className={`flex items-center gap-3 p-2.5 border rounded-lg ${
                      isConfirming ? 'border-red-300 bg-red-50' : 'border-[#EDEDED]'
                    }`}
                  >
                    <div className="w-7 h-7 rounded-full bg-[#1F114C]/10 flex items-center justify-center text-[10px] font-semibold text-[#1F114C]">
                      {email.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-700 font-medium truncate">{email}</div>
                    </div>
                    <button
                      onClick={() => handleRemoveEmail(email)}
                      disabled={removeEmailMutation.isPending}
                      className={`text-xs font-medium whitespace-nowrap px-2 py-1 rounded ${
                        isConfirming
                          ? 'bg-[#DD0C15] text-white hover:bg-red-700'
                          : 'text-gray-400 hover:text-[#DD0C15] hover:bg-red-50'
                      } disabled:opacity-50`}
                    >
                      {isConfirming ? 'Confirmar' : 'Eliminar'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Info note */}
          <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-3 flex gap-2">
            <svg className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
            </svg>
            <p className="text-xs text-blue-700 leading-relaxed">
              Solo los emails en esta lista pueden acceder al panel de Platform Owner.
            </p>
          </div>
        </div>

        {/* Column 2: Acciones Rapidas */}
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
          <h3 className="text-sm font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <svg className="w-4 h-4 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
            </svg>
            Acciones Rapidas
          </h3>

          {/* Reset Password */}
          <div className="mb-4">
            <label className="text-xs text-gray-500 font-medium mb-1.5 block">Resetear Contrasena</label>
            <div className="flex gap-2">
              <input
                type="email"
                placeholder="email@organizacion.co"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                className="flex-1 border border-[#EDEDED] rounded-lg px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-[#1F114C]/20"
              />
              <button
                onClick={() => {
                  // Stub: password reset
                  if (resetEmail.trim()) {
                    alert(`Reset de contrasena enviado a: ${resetEmail}`);
                    setResetEmail('');
                  }
                }}
                className="px-3 py-2 bg-[#1F114C] text-white rounded-lg text-sm font-medium hover:bg-[#2D1B69] whitespace-nowrap"
              >
                Reset
              </button>
            </div>
          </div>

          {/* Send Notification */}
          <div>
            <label className="text-xs text-gray-500 font-medium mb-1.5 block">Enviar Notificacion a Org</label>
            <select
              value={notifOrg}
              onChange={(e) => setNotifOrg(e.target.value)}
              className="w-full border border-[#EDEDED] rounded-lg px-3 py-2 text-sm text-gray-600 bg-white mb-2 focus:outline-none focus:ring-1 focus:ring-[#1F114C]/20"
            >
              <option value="">Seleccionar organizacion...</option>
              <option value="all">Todas las organizaciones</option>
            </select>
            <textarea
              placeholder="Escribir mensaje de notificacion..."
              rows={3}
              value={notifMessage}
              onChange={(e) => setNotifMessage(e.target.value)}
              className="w-full border border-[#EDEDED] rounded-lg px-3 py-2 text-sm placeholder:text-gray-400 resize-none mb-2 focus:outline-none focus:ring-1 focus:ring-[#1F114C]/20"
            />
            <button
              onClick={() => {
                // Stub: send notification
                if (notifOrg && notifMessage.trim()) {
                  alert(`Notificacion enviada a: ${notifOrg}`);
                  setNotifOrg('');
                  setNotifMessage('');
                }
              }}
              className="w-full px-3 py-2 bg-[#1F114C] text-white rounded-lg text-sm font-medium hover:bg-[#2D1B69] flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <path d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
              </svg>
              Enviar
            </button>
          </div>
        </div>

        {/* Column 3: Solicitudes de Datos */}
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
          <h3 className="text-sm font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <svg className="w-4 h-4 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
            </svg>
            Solicitudes de Datos
          </h3>
          <div className="text-[11px] text-gray-400 uppercase tracking-wide mb-2">GDPR / Habeas Data</div>
          <div className="space-y-3">
            {/* Placeholder Request 1 */}
            <div className="border border-[#EDEDED] rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-purple-100 flex items-center justify-center text-[10px] font-semibold text-purple-600">MV</div>
                  <span className="text-sm text-gray-700 font-medium">Maria Vargas</span>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-700">Pendiente</span>
              </div>
              <div className="flex items-center justify-between text-xs text-gray-500">
                <div>
                  <span className="text-gray-400">Org:</span> Bancolombia
                  <span className="text-gray-300 mx-1">|</span>
                  <span className="text-gray-400">Tipo:</span>
                  <span className="text-blue-600 font-medium"> Exportacion</span>
                </div>
                <span>28 May 2026</span>
              </div>
              <button className="mt-2 w-full px-3 py-1.5 border border-[#1F114C] text-[#1F114C] rounded-lg text-xs font-medium hover:bg-[#1F114C]/5">
                Procesar
              </button>
            </div>

            {/* Placeholder Request 2 */}
            <div className="border border-[#EDEDED] rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-teal-100 flex items-center justify-center text-[10px] font-semibold text-teal-600">DP</div>
                  <span className="text-sm text-gray-700 font-medium">Diego Perez</span>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-700">Pendiente</span>
              </div>
              <div className="flex items-center justify-between text-xs text-gray-500">
                <div>
                  <span className="text-gray-400">Org:</span> Rappi
                  <span className="text-gray-300 mx-1">|</span>
                  <span className="text-gray-400">Tipo:</span>
                  <span className="text-red-600 font-medium"> Eliminacion</span>
                </div>
                <span>26 May 2026</span>
              </div>
              <button className="mt-2 w-full px-3 py-1.5 border border-[#1F114C] text-[#1F114C] rounded-lg text-xs font-medium hover:bg-[#1F114C]/5">
                Procesar
              </button>
            </div>

            {/* Placeholder Request 3 - Completed */}
            <div className="border border-[#EDEDED] rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-pink-100 flex items-center justify-center text-[10px] font-semibold text-pink-600">SL</div>
                  <span className="text-sm text-gray-700 font-medium">Sofia Luna</span>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-100 text-green-700">Completado</span>
              </div>
              <div className="flex items-center justify-between text-xs text-gray-500">
                <div>
                  <span className="text-gray-400">Org:</span> Grupo Bolivar
                  <span className="text-gray-300 mx-1">|</span>
                  <span className="text-gray-400">Tipo:</span>
                  <span className="text-blue-600 font-medium"> Exportacion</span>
                </div>
                <span>20 May 2026</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-2 gap-5">
        {/* Errores Recientes (placeholder) */}
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
              <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <path d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
              Errores Recientes
            </h3>
            <span className="text-xs text-gray-400">Ultimas 24h</span>
          </div>
          <div className="overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#EDEDED]">
                  <th className="text-left text-[10px] text-gray-400 uppercase tracking-wider font-medium pb-2">Hora</th>
                  <th className="text-left text-[10px] text-gray-400 uppercase tracking-wider font-medium pb-2">Org</th>
                  <th className="text-left text-[10px] text-gray-400 uppercase tracking-wider font-medium pb-2">Servicio</th>
                  <th className="text-left text-[10px] text-gray-400 uppercase tracking-wider font-medium pb-2">Error</th>
                  <th className="text-left text-[10px] text-gray-400 uppercase tracking-wider font-medium pb-2">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {[
                  { time: '14:32', org: 'Rappi', service: 'AI Screening', error: 'Timeout en llamada a Bedrock API', status: 'Abierto', statusColor: 'bg-red-50 text-red-600' },
                  { time: '13:18', org: 'Bancolombia', service: 'Email (SES)', error: 'Bounce rate elevado en dominio bc.co', status: 'Invest.', statusColor: 'bg-amber-50 text-amber-600' },
                  { time: '11:45', org: 'Grupo Bolivar', service: 'Auth', error: 'SSO callback failed: invalid state', status: 'Resuelto', statusColor: 'bg-green-50 text-green-600' },
                  { time: '10:02', org: 'Rappi', service: 'Storage', error: 'Upload fallido: archivo excede 10MB', status: 'Resuelto', statusColor: 'bg-green-50 text-green-600' },
                  { time: '08:47', org: 'Bancolombia', service: 'CV Parser', error: 'ParseError: formato .docx corrupto', status: 'Resuelto', statusColor: 'bg-green-50 text-green-600' },
                  { time: '07:22', org: 'Grupo Bolivar', service: 'Pipeline', error: 'Webhook delivery failed: 503', status: 'Abierto', statusColor: 'bg-red-50 text-red-600' },
                ].map((row, i) => (
                  <tr key={i}>
                    <td className="py-2 text-[11px] text-gray-500 whitespace-nowrap">{row.time}</td>
                    <td className="py-2 text-[11px] text-gray-600">{row.org}</td>
                    <td className="py-2 text-[11px] text-gray-600">{row.service}</td>
                    <td className="py-2 text-[11px] text-gray-500 max-w-[180px] truncate">{row.error}</td>
                    <td className="py-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${row.statusColor}`}>{row.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Sesiones Activas (placeholder) */}
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
              <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <path d="M9.348 14.651a3.75 3.75 0 010-5.303m5.304 0a3.75 3.75 0 010 5.303m-7.425 2.122a6.75 6.75 0 010-9.546m9.546 0a6.75 6.75 0 010 9.546M5.106 18.894c-3.808-3.808-3.808-9.98 0-13.789m13.788 0c3.808 3.808 3.808 9.981 0 13.79M12 12.75h.008v.008H12v-.008z" />
              </svg>
              Sesiones Activas
            </h3>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-sm font-semibold text-gray-800">--</span>
              <span className="text-xs text-gray-400">total activas</span>
            </div>
          </div>

          {/* Sessions by Org (placeholder) */}
          <div className="text-[11px] text-gray-400 uppercase tracking-wide mb-3">Por Organizacion (Top 5)</div>
          <div className="space-y-3 mb-5">
            {[
              { name: 'Bancolombia', count: 87, pct: 35, color: '#1F114C' },
              { name: 'Rappi', count: 68, pct: 28, color: '#2D1B69' },
              { name: 'Grupo Bolivar', count: 54, pct: 22, color: '#3D2980' },
              { name: 'Ecopetrol', count: 24, pct: 10, color: '#5B42A5' },
              { name: 'Nu Colombia', count: 14, pct: 6, color: '#7B6BBF' },
            ].map((org) => (
              <div key={org.name} className="flex items-center gap-3">
                <span className="text-sm text-gray-600 w-[120px]">{org.name}</span>
                <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                  <div
                    className="h-full rounded-full flex items-center pr-2"
                    style={{
                      width: `${org.pct}%`,
                      backgroundColor: org.color,
                      justifyContent: org.pct > 15 ? 'flex-end' : 'flex-start',
                    }}
                  >
                    <span className={`text-[9px] text-white font-medium ${org.pct <= 15 ? 'ml-1' : ''}`}>{org.count}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Session Stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <div className="text-lg font-bold text-gray-800">247</div>
              <div className="text-[10px] text-gray-400 uppercase">Activas</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <div className="text-lg font-bold text-gray-800">18m</div>
              <div className="text-[10px] text-gray-400 uppercase">Duracion Prom.</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <div className="text-lg font-bold text-gray-800">1,203</div>
              <div className="text-[10px] text-gray-400 uppercase">Hoy Total</div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
