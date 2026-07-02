'use client';

import { useState } from 'react';
import { createSupabaseBrowserClient } from '@tims/auth/client';
import Link from 'next/link';
import { useI18n } from '../../../lib/i18n';

export default function ForgotPasswordPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const supabase = createSupabaseBrowserClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (resetError) {
      setError(resetError.message);
      setLoading(false);
      return;
    }

    setSent(true);
    setLoading(false);
  };

  return (
    <div className="w-full max-w-[420px]">
        <div className="text-center mb-8 lg:hidden">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#1F114C] mb-4">
            <span className="text-white text-xl font-bold">T</span>
          </div>
          <h1 className="text-2xl font-bold text-[#1F114C]">{t.auth.recoverPassword}</h1>
          <p className="text-sm text-[#8B8B8B] mt-1">{t.auth.recoverSubtitle}</p>
        </div>

        <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.08)] p-8">
          {sent ? (
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" /></svg>
              </div>
              <h3 className="text-[15px] font-semibold text-[#1F114C] mb-2">{t.auth.emailSentTitle}</h3>
              <p className="text-[13px] text-[#585858] mb-4">
                {t.auth.checkInboxAt} <strong>{email}</strong> {t.auth.followInstructions}
              </p>
              <Link href="/login" className="text-[13px] text-[#DD0C15] font-medium hover:underline">
                {t.auth.backToLogin}
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-[13px] text-red-700">{error}</div>
              )}
              <div>
                <label className="block text-[12px] font-medium text-[#585858] mb-1.5">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full h-11 px-4 rounded-xl border border-[#EDEDED] text-[13px] text-[#333] placeholder:text-[#8B8B8B] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 focus:border-[#1F114C] transition"
                  placeholder="tu@empresa.com"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full h-11 rounded-xl bg-[#1F114C] text-white text-[13px] font-semibold hover:bg-[#2a1a5e] disabled:opacity-50 transition"
              >
                {loading ? t.auth.sendingLink : t.auth.sendLink}
              </button>
              <div className="text-center">
                <Link href="/login" className="text-[12px] text-[#8B8B8B] hover:text-[#585858]">{t.auth.backToLogin}</Link>
              </div>
            </form>
          )}
        </div>
    </div>
  );
}
