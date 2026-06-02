'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';

export function QuickActions() {
  const { t } = useI18n();
  const [resetEmail, setResetEmail] = useState('');
  const [notifOrgId, setNotifOrgId] = useState('');
  const [notifTitle, setNotifTitle] = useState('');
  const [notifMessage, setNotifMessage] = useState('');
  const [notifType, setNotifType] = useState<'info' | 'warning' | 'critical' | 'success'>('info');

  const { data: orgs } = trpc.platform.listOrganizationsMinimal.useQuery();

  const resetMutation = trpc.platform.resetUserPassword.useMutation({
    onSuccess: (data) => { toast(`Reset enviado a ${data.email}`, { type: 'success' }); setResetEmail(''); },
    onError: (err) => { toast(err.message, { type: 'error' }); },
  });

  const notifMutation = trpc.platform.sendBulkNotification.useMutation({
    onSuccess: (data) => { toast(`${t.support.sendNotification}: ${data.sent}`, { type: 'success' }); setNotifTitle(''); setNotifMessage(''); setNotifOrgId(''); setNotifType('info'); },
    onError: (err) => { toast(err.message, { type: 'error' }); },
  });

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
      <h3 className="text-sm font-semibold text-[#333] mb-4 flex items-center gap-2">
        <svg className="w-4 h-4 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" /></svg>
        {t.support.quickActions}
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Reset Password */}
        <form onSubmit={(e) => { e.preventDefault(); const em = resetEmail.trim(); if (em && em.includes('@')) resetMutation.mutate({ email: em }); }} className="border border-[#EDEDED] rounded-lg p-4">
          <label className="text-xs text-[#8B8B8B] font-medium mb-2 block">{t.support.resetPassword}</label>
          <div className="flex gap-2">
            <input type="email" placeholder={t.support.resetPlaceholder} value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} className="flex-1 border border-[#EDEDED] rounded-lg px-3 py-2 text-sm placeholder:text-[#ABABAB] focus:outline-none focus:ring-1 focus:ring-[#1F114C]/20" />
            <button type="submit" disabled={resetMutation.isPending || !resetEmail.trim()} className="px-3 py-2 bg-[#1F114C] text-white rounded-lg text-sm font-medium hover:bg-[#2a1866] whitespace-nowrap disabled:opacity-50">
              {resetMutation.isPending ? '...' : t.support.sendReset}
            </button>
          </div>
          <p className="text-[11px] text-[#ABABAB] mt-2">{t.support.resetDesc}</p>
        </form>

        {/* Send Notification */}
        <form onSubmit={(e) => { e.preventDefault(); if (notifTitle.trim() && notifMessage.trim()) notifMutation.mutate({ organizationId: notifOrgId || undefined, title: notifTitle.trim(), message: notifMessage.trim(), type: notifType }); }} className="border border-[#EDEDED] rounded-lg p-4">
          <label className="text-xs text-[#8B8B8B] font-medium mb-2 block">{t.support.sendNotification}</label>
          <select value={notifOrgId} onChange={(e) => setNotifOrgId(e.target.value)} className="w-full border border-[#EDEDED] rounded-lg px-3 py-2 text-sm text-[#585858] bg-white mb-2 focus:outline-none focus:ring-1 focus:ring-[#1F114C]/20">
            <option value="">{t.support.allOrgs}</option>
            {orgs?.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
          </select>
          <select value={notifType} onChange={(e) => setNotifType(e.target.value as typeof notifType)} className="w-full border border-[#EDEDED] rounded-lg px-3 py-2 text-sm text-[#585858] bg-white mb-2 focus:outline-none focus:ring-1 focus:ring-[#1F114C]/20">
            <option value="info">{t.support.typeInfo}</option>
            <option value="warning">{t.support.typeWarning}</option>
            <option value="critical">{t.support.typeCritical}</option>
            <option value="success">{t.support.typeSuccess}</option>
          </select>
          <input type="text" placeholder={t.support.notifTitle} value={notifTitle} onChange={(e) => setNotifTitle(e.target.value)} maxLength={200} className="w-full border border-[#EDEDED] rounded-lg px-3 py-2 text-sm placeholder:text-[#ABABAB] mb-2 focus:outline-none focus:ring-1 focus:ring-[#1F114C]/20" />
          <textarea placeholder={t.support.notifMessage} rows={3} value={notifMessage} onChange={(e) => setNotifMessage(e.target.value)} maxLength={1000} className="w-full border border-[#EDEDED] rounded-lg px-3 py-2 text-sm placeholder:text-[#ABABAB] resize-none mb-2 focus:outline-none focus:ring-1 focus:ring-[#1F114C]/20" />
          <button type="submit" disabled={notifMutation.isPending || !notifTitle.trim() || !notifMessage.trim()} className="w-full px-3 py-2 bg-[#1F114C] text-white rounded-lg text-sm font-medium hover:bg-[#2a1866] flex items-center justify-center gap-2 disabled:opacity-50">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" /></svg>
            {notifMutation.isPending ? t.support.sending : t.support.sendNotification}
          </button>
        </form>
      </div>
    </div>
  );
}
