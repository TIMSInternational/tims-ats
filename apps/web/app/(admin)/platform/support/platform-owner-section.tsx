'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';

export function PlatformOwnerSection() {
  const [newEmail, setNewEmail] = useState('');
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
  );
}
