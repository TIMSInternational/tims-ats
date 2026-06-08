'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { createSupabaseBrowserClient } from '@tims/auth/client';
import { useI18n } from '../../../../../lib/i18n';

// Candidate portal login — passwordless magic link. We always show the same
// "check your email" confirmation regardless of whether the email maps to a
// candidate (no account enumeration); access is gated downstream at /me by the
// Candidate lookup.
export default function PortalLoginPage() {
  const { orgSlug } = useParams<{ orgSlug: string }>();
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = email.trim();
    if (!value || !value.includes('@')) return;
    setBusy(true);
    setError('');
    const supabase = createSupabaseBrowserClient();
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: value,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/careers/${orgSlug}/me` },
    });
    setBusy(false);
    if (otpError) {
      setError(t.portalAuth.errorGeneric);
      return;
    }
    setSent(true);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F6F6F6] px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#1F114C] mb-4">
            <span className="text-white text-xl font-bold">T</span>
          </div>
          <h1 className="text-[22px] font-bold text-[#1F114C]">{t.portalAuth.loginTitle}</h1>
          <p className="text-[13px] text-[#8B8B8B] mt-1">{t.portalAuth.loginSubtitle}</p>
        </div>

        <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.08)] p-8">
          {sent ? (
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" /></svg>
              </div>
              <h3 className="text-[15px] font-semibold text-[#1F114C] mb-2">{t.portalAuth.checkEmailTitle}</h3>
              <p className="text-[13px] text-[#585858]">{t.portalAuth.checkEmailDesc}</p>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-[13px] text-red-700">{error}</div>
              )}
              <div>
                <label className="block text-[12px] font-medium text-[#585858] mb-1.5">{t.portalAuth.emailLabel}</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t.portalAuth.emailPlaceholder}
                  className="w-full h-11 px-4 rounded-xl border border-[#EDEDED] text-[13px] text-[#333] placeholder:text-[#8B8B8B] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 focus:border-[#1F114C] transition"
                />
              </div>
              <button
                type="submit"
                disabled={busy || !email.trim()}
                className="w-full h-11 rounded-xl bg-[#1F114C] text-white text-[13px] font-semibold hover:bg-[#2a1a5e] disabled:opacity-50 transition"
              >
                {busy ? t.portalAuth.sending : t.portalAuth.sendLink}
              </button>
            </form>
          )}
        </div>

        <div className="text-center mt-5">
          <Link href={`/careers/${orgSlug}`} className="text-[13px] text-[#8B8B8B] hover:text-[#585858] hover:underline">
            {t.portalAuth.backToJobs}
          </Link>
        </div>
      </div>
    </div>
  );
}
