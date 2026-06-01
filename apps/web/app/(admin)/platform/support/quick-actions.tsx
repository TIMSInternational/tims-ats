'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';

export function QuickActions() {
  // Reset password state
  const [resetEmail, setResetEmail] = useState('');

  // Notification state
  const [notifOrgId, setNotifOrgId] = useState('');
  const [notifTitle, setNotifTitle] = useState('');
  const [notifMessage, setNotifMessage] = useState('');
  const [notifType, setNotifType] = useState<'info' | 'warning' | 'critical' | 'success'>('info');

  const { data: orgs } = trpc.platform.listOrganizations.useQuery(
    { page: 0, limit: 50 },
    { staleTime: 60_000 },
  );

  const resetMutation = trpc.platform.resetUserPassword.useMutation({
    onSuccess: (data) => {
      toast(`Reset enviado a ${data.email}`, { type: 'success' });
      setResetEmail('');
    },
    onError: (err) => {
      toast(err.message || 'Error al enviar reset', { type: 'error' });
    },
  });

  const notifMutation = trpc.platform.sendBulkNotification.useMutation({
    onSuccess: (data) => {
      toast(`Notificacion enviada a ${data.sent} usuario(s)`, { type: 'success' });
      setNotifTitle('');
      setNotifMessage('');
      setNotifOrgId('');
      setNotifType('info');
    },
    onError: (err) => {
      toast(err.message || 'Error al enviar notificacion', { type: 'error' });
    },
  });

  function handleReset(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = resetEmail.trim();
    if (!trimmed || !trimmed.includes('@')) return;
    resetMutation.mutate({ email: trimmed });
  }

  function handleSendNotification(e: React.FormEvent) {
    e.preventDefault();
    if (!notifTitle.trim() || !notifMessage.trim()) return;
    notifMutation.mutate({
      organizationId: notifOrgId || undefined,
      title: notifTitle.trim(),
      message: notifMessage.trim(),
      type: notifType,
    });
  }

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
      <h3 className="text-sm font-semibold text-gray-800 mb-4 flex items-center gap-2">
        <svg className="w-4 h-4 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
          <path d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
        </svg>
        Acciones Rapidas
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Reset Password */}
        <form onSubmit={handleReset} className="border border-[#EDEDED] rounded-lg p-4">
          <label className="text-xs text-gray-500 font-medium mb-2 block">Resetear Contrasena</label>
          <div className="flex gap-2">
            <input
              type="email"
              placeholder="email@organizacion.co"
              value={resetEmail}
              onChange={(e) => setResetEmail(e.target.value)}
              className="flex-1 border border-[#EDEDED] rounded-lg px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-[#1F114C]/20"
            />
            <button
              type="submit"
              disabled={resetMutation.isPending || !resetEmail.trim()}
              className="px-3 py-2 bg-[#1F114C] text-white rounded-lg text-sm font-medium hover:bg-[#2D1B69] whitespace-nowrap disabled:opacity-50"
            >
              {resetMutation.isPending ? '...' : 'Enviar Reset'}
            </button>
          </div>
          <p className="text-[11px] text-gray-400 mt-2">
            Envia un email de restablecimiento al usuario.
          </p>
        </form>

        {/* Send Notification */}
        <form onSubmit={handleSendNotification} className="border border-[#EDEDED] rounded-lg p-4">
          <label className="text-xs text-gray-500 font-medium mb-2 block">Enviar Notificacion</label>
          <select
            value={notifOrgId}
            onChange={(e) => setNotifOrgId(e.target.value)}
            className="w-full border border-[#EDEDED] rounded-lg px-3 py-2 text-sm text-gray-600 bg-white mb-2 focus:outline-none focus:ring-1 focus:ring-[#1F114C]/20"
          >
            <option value="">Todas las organizaciones</option>
            {orgs?.organizations?.map((org) => (
              <option key={org.id} value={org.id}>{org.name}</option>
            ))}
          </select>
          <select
            value={notifType}
            onChange={(e) => setNotifType(e.target.value as typeof notifType)}
            className="w-full border border-[#EDEDED] rounded-lg px-3 py-2 text-sm text-gray-600 bg-white mb-2 focus:outline-none focus:ring-1 focus:ring-[#1F114C]/20"
          >
            <option value="info">Info</option>
            <option value="warning">Advertencia</option>
            <option value="critical">Critico</option>
            <option value="success">Exito</option>
          </select>
          <input
            type="text"
            placeholder="Titulo de la notificacion"
            value={notifTitle}
            onChange={(e) => setNotifTitle(e.target.value)}
            maxLength={200}
            className="w-full border border-[#EDEDED] rounded-lg px-3 py-2 text-sm placeholder:text-gray-400 mb-2 focus:outline-none focus:ring-1 focus:ring-[#1F114C]/20"
          />
          <textarea
            placeholder="Mensaje de la notificacion..."
            rows={3}
            value={notifMessage}
            onChange={(e) => setNotifMessage(e.target.value)}
            maxLength={1000}
            className="w-full border border-[#EDEDED] rounded-lg px-3 py-2 text-sm placeholder:text-gray-400 resize-none mb-2 focus:outline-none focus:ring-1 focus:ring-[#1F114C]/20"
          />
          <button
            type="submit"
            disabled={notifMutation.isPending || !notifTitle.trim() || !notifMessage.trim()}
            className="w-full px-3 py-2 bg-[#1F114C] text-white rounded-lg text-sm font-medium hover:bg-[#2D1B69] flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
            {notifMutation.isPending ? 'Enviando...' : 'Enviar Notificacion'}
          </button>
        </form>
      </div>
    </div>
  );
}
