'use client';

import { useState } from 'react';
import { toast } from '../../../../../lib/toast';

interface SigningLinkModalProps {
  signingUrl: string;
  onClose: () => void;
}

export function SigningLinkModal({ signingUrl, onClose }: SigningLinkModalProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(signingUrl);
      setCopied(true);
      toast('Enlace copiado al portapapeles', { type: 'success' });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast('No se pudo copiar el enlace', { type: 'error' });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 border-b border-[#F0F0F0]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-2.06a4.5 4.5 0 00-6.364-6.364L4.5 8.25a4.5 4.5 0 006.364 6.364l4.5-4.5z" />
                </svg>
              </div>
              <div>
                <h2 className="text-[16px] font-semibold text-[#1F114C]">Enlace de Firma Generado</h2>
                <p className="text-[12px] text-[#8B8B8B]">Comparte este enlace con el candidato</p>
              </div>
            </div>
            <button onClick={onClose} className="text-[#8B8B8B] hover:text-[#333] transition">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <path d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs text-[#8B8B8B] mb-1.5">Enlace de firma</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={signingUrl}
                readOnly
                className="flex-1 h-10 px-3 rounded-lg border border-[#E5E5E5] text-sm text-[#333] bg-[#FAFAFA] truncate"
              />
              <button
                onClick={handleCopy}
                className="shrink-0 h-10 px-4 rounded-lg bg-[#1F114C] text-white text-sm font-medium hover:bg-[#2a1866] transition flex items-center gap-1.5"
              >
                {copied ? (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M5 13l4 4L19 7" />
                    </svg>
                    Copiado
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                    </svg>
                    Copiar
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="bg-[#F8F7FC] rounded-xl p-4">
            <p className="text-[12px] text-[#585858] leading-relaxed">
              El candidato podra ver los detalles de la oferta y firmar digitalmente.
              El enlace permanecera activo hasta que la oferta sea aceptada o declinada.
            </p>
          </div>

          <button
            onClick={() => toast('Envio por email: proximamente', { type: 'info' })}
            className="w-full h-10 rounded-lg border border-[#E5E5E5] text-[13px] text-[#585858] font-medium hover:bg-[#F6F6F6] transition flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
            </svg>
            Enviar por Email
          </button>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#F0F0F0] flex justify-end">
          <button
            onClick={onClose}
            className="h-9 px-5 rounded-lg text-[13px] font-medium text-[#585858] hover:bg-[#F6F6F6] transition"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
