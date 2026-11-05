'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { ErrorState } from '../../../../components';

export function PlatformOwnerSection() {
  const { t } = useI18n();
  const [newEmail, setNewEmail] = useState('');
  // The allowlist grants cross-tenant access, so the address is typed twice before it is added
  // (platform-owner journeys-30): a typo can no longer authorize a stranger's mailbox.
  const [confirmEmail, setConfirmEmail] = useState('');
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const utils = trpc.useUtils();

  const { data: emailsData, isLoading, isError, refetch } = trpc.platform.listPlatformOwnerEmails.useQuery();
  const addEmail = trpc.platform.addPlatformOwnerEmail.useMutation({
    onSuccess: () => { setNewEmail(''); setConfirmEmail(''); utils.platform.listPlatformOwnerEmails.invalidate(); toast(t.support.emailAdded, { type: 'success' }); },
    onError: (err) => { toast(err.message, { type: 'error' }); },
  });
  const removeEmail = trpc.platform.removePlatformOwnerEmail.useMutation({
    onSuccess: (result) => {
      setConfirmRemove(null);
      utils.platform.listPlatformOwnerEmails.invalidate();
      toast(result.ownersRevoked > 0 ? `${t.support.emailRemoved}. ${t.support.ownerAccessRevoked}` : t.support.emailRemoved, { type: 'success' });
    },
    onError: (err) => { toast(err.message, { type: 'error' }); },
  });

  const emails = emailsData ?? [];
  const typed = newEmail.trim().toLowerCase();
  const confirmed = confirmEmail.trim().toLowerCase();
  const mismatch = confirmed.length > 0 && typed !== confirmed;
  const canAdd = typed.includes('@') && typed === confirmed && !addEmail.isPending;

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
      <h3 className="text-sm font-semibold text-[#333] mb-4 flex items-center gap-2">
        <svg className="w-4 h-4 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" /></svg>
        {t.support.platformOwnerEmails}
      </h3>

      <form onSubmit={(e) => { e.preventDefault(); if (canAdd) addEmail.mutate({ email: typed }); }} className="mb-4 space-y-2">
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{t.support.addOwnerWarning}</p>
        <div>
          <label htmlFor="owner-email" className="block text-[11px] font-medium text-[#585858] mb-1">{t.support.ownerEmailLabel}</label>
          <input id="owner-email" type="email" maxLength={255} autoComplete="off" placeholder="nuevo@email.com" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} className="w-full border border-[#EDEDED] rounded-lg px-3 py-2.5 text-sm placeholder:text-[#ABABAB] focus:outline-none focus:ring-1 focus:ring-[#1F114C]/20 focus:border-[#1F114C]/30" />
        </div>
        <div>
          <label htmlFor="owner-email-confirm" className="block text-[11px] font-medium text-[#585858] mb-1">{t.support.confirmEmailLabel}</label>
          <div className="flex gap-2">
            <input id="owner-email-confirm" type="email" maxLength={255} autoComplete="off" value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} onPaste={(e) => e.preventDefault()} aria-invalid={mismatch || undefined} aria-describedby={mismatch ? 'owner-email-mismatch' : undefined} className="flex-1 border border-[#EDEDED] rounded-lg px-3 py-2.5 text-sm placeholder:text-[#ABABAB] focus:outline-none focus:ring-1 focus:ring-[#1F114C]/20 focus:border-[#1F114C]/30" />
            <button type="submit" disabled={!canAdd} className="px-3 py-2 bg-[#1F114C] text-white rounded-lg text-sm font-medium hover:bg-[#2a1866] whitespace-nowrap disabled:opacity-50">
              {addEmail.isPending ? t.support.adding : t.support.addEmail}
            </button>
          </div>
          {mismatch && <p id="owner-email-mismatch" role="alert" className="mt-1 text-xs text-[#DD0C15]">{t.support.confirmEmailMismatch}</p>}
        </div>
      </form>

      <div className="text-[11px] text-[#8B8B8B] uppercase tracking-wide mb-2">{t.support.currentWhitelist}</div>
      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-10 bg-[#F6F6F6] rounded-lg animate-pulse" />)}</div>
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : emails.length === 0 ? (
        <div className="py-6 text-center">
          <p className="text-sm text-[#8B8B8B]">{t.support.noEmails}</p>
          <p className="text-xs text-[#ABABAB] mt-1">{t.support.noEmailsDesc}</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[280px] overflow-y-auto">
          {emails.map((item) => {
            const email = typeof item === 'string' ? item : item.email;
            const isConfirming = confirmRemove === email;
            return (
              <div key={email} className={`flex items-center gap-3 p-2.5 border rounded-lg ${isConfirming ? 'border-red-300 bg-red-50' : 'border-[#EDEDED]'}`}>
                <div className="w-7 h-7 rounded-full bg-[#1F114C]/10 flex items-center justify-center text-[10px] font-semibold text-[#1F114C]">{email.charAt(0).toUpperCase()}</div>
                <div className="flex-1 min-w-0"><div className="text-sm text-[#585858] font-medium truncate">{email}</div></div>
                <button onClick={() => isConfirming ? removeEmail.mutate({ email }) : setConfirmRemove(email)} disabled={removeEmail.isPending} className={`text-xs font-medium whitespace-nowrap px-2 py-1 rounded ${isConfirming ? 'bg-[#DD0C15] text-white hover:bg-red-700' : 'text-[#8B8B8B] hover:text-[#DD0C15] hover:bg-red-50'} disabled:opacity-50`}>
                  {isConfirming ? t.support.confirm : t.support.remove}
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-3 flex gap-2">
        <svg className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" /></svg>
        <p className="text-xs text-blue-700 leading-relaxed">{t.support.whitelistInfo}</p>
      </div>
    </div>
  );
}
