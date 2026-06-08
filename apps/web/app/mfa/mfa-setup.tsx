'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@tims/auth/client';
import { useI18n } from '../../lib/i18n';
import { mfaMode, type MfaMode, type Aal } from '../../lib/mfa';

// Two-factor (TOTP) setup + step-up, backed by Supabase Auth MFA. Three modes,
// derived purely in lib/mfa.ts:
//   enroll    — no verified factor: show QR + secret, verify a code to activate
//   challenge — verified factor but session is aal1: step up with a code
//   enabled   — verified factor and session is aal2: manage / disable
export function MfaSetup() {
  const router = useRouter();
  const { t } = useI18n();

  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<MfaMode>('enroll');
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Stable reference (the browser client is a module singleton; useMemo makes the
  // stability explicit so the callbacks below memoize correctly).
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  // Begin enrollment: clear any abandoned unverified factor, then create a fresh
  // TOTP factor and surface its QR + secret.
  const beginEnroll = useCallback(async () => {
    setError('');
    const { data: existing } = await supabase.auth.mfa.listFactors();
    for (const f of existing?.all ?? []) {
      if ((f as { status: string }).status === 'unverified') {
        await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
    }
    const { data, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
    if (enrollError || !data) {
      setError(t.mfa.errorGeneric);
      return;
    }
    setFactorId(data.id);
    setQr(data.totp.qr_code);
    setSecret(data.totp.secret);
  }, [supabase, t]);

  // Load current factor + assurance level, pick the mode, and kick off enrollment
  // when there is nothing to step up to.
  const refresh = useCallback(async () => {
    setLoading(true);
    const [{ data: aalData }, { data: factorsData }] = await Promise.all([
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      supabase.auth.mfa.listFactors(),
    ]);
    const verified = (factorsData?.totp ?? []).filter(
      (f: { status: string }) => f.status === 'verified',
    );
    const next = mfaMode({
      hasVerifiedFactor: verified.length > 0,
      currentLevel: aalData?.currentLevel as Aal,
    });
    setMode(next);
    if (next === 'challenge') setFactorId(verified[0].id);
    if (next === 'enroll') await beginEnroll();
    setLoading(false);
  }, [supabase, beginEnroll]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Verify a 6-digit code — same call for finishing enrollment and for step-up.
  // On success the session is elevated to aal2; force a server re-render so the
  // (admin) MFA gate now passes.
  const submitCode = async () => {
    if (!factorId || code.length < 6) return;
    setBusy(true);
    setError('');
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    setBusy(false);
    if (verifyError) {
      setError(t.mfa.errorInvalidCode);
      setCode('');
      return;
    }
    setCode('');
    if (mode === 'challenge') {
      router.push('/dashboard');
      router.refresh();
    } else {
      await refresh();
    }
  };

  const disable = async () => {
    setBusy(true);
    setError('');
    const { data: factorsData } = await supabase.auth.mfa.listFactors();
    for (const f of factorsData?.all ?? []) {
      // Supabase requires an aal2 session to unenroll a verified factor; surface
      // the error instead of silently leaving MFA enabled.
      const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId: f.id });
      if (unenrollError) {
        setError(t.mfa.errorGeneric);
        setBusy(false);
        return;
      }
    }
    setBusy(false);
    setFactorId(null);
    await refresh();
    router.refresh();
  };

  const onCodeChange = (v: string) => setCode(v.replace(/\D/g, '').slice(0, 6));

  return (
    <div className="w-full max-w-[440px]">
      <div className="text-center mb-6">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#1F114C] mb-4">
          <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
          </svg>
        </div>
        <h1 className="text-[22px] font-bold text-[#1F114C]">{t.mfa.title}</h1>
        <p className="text-[13px] text-[#8B8B8B] mt-1">{t.mfa.subtitle}</p>
      </div>

      <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.08)] p-8">
        {loading ? (
          <p className="text-center text-[13px] text-[#585858]">{t.mfa.loading}</p>
        ) : mode === 'enabled' ? (
          <div className="text-center">
            <div className="w-12 h-12 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" /></svg>
            </div>
            <h3 className="text-[15px] font-semibold text-[#1F114C] mb-1">{t.mfa.enabledTitle}</h3>
            <p className="text-[13px] text-[#585858] mb-6">{t.mfa.enabledDesc}</p>
            <button
              onClick={disable}
              disabled={busy}
              className="w-full h-11 rounded-xl border border-red-200 text-red-600 text-[13px] font-semibold hover:bg-red-50 disabled:opacity-50 transition mb-3"
            >
              {busy ? t.mfa.disabling : t.mfa.disable}
            </button>
            <a href="/dashboard" className="text-[13px] text-[#1F114C] font-medium hover:underline">{t.mfa.backToDashboard}</a>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <h3 className="text-[15px] font-semibold text-[#1F114C] mb-1">
                {mode === 'enroll' ? t.mfa.enrollTitle : t.mfa.challengeTitle}
              </h3>
              <p className="text-[13px] text-[#585858]">
                {mode === 'enroll' ? t.mfa.enrollScan : t.mfa.challengeDesc}
              </p>
            </div>

            {mode === 'enroll' && qr && (
              <div className="flex flex-col items-center gap-3">
                {/* Supabase returns the QR as an SVG data URI — render directly. */}
                <img src={qr} alt="" className="w-44 h-44 rounded-xl border border-[#EDEDED]" />
                {secret && (
                  <div className="w-full">
                    <p className="text-[11px] text-[#8B8B8B] mb-1">{t.mfa.secretLabel}</p>
                    <code className="block w-full text-center text-[12px] font-mono tracking-wider text-[#333] bg-[#F6F6F6] rounded-lg px-3 py-2 break-all">
                      {secret}
                    </code>
                  </div>
                )}
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-[13px] text-red-700">{error}</div>
            )}

            <div>
              <label className="block text-[12px] font-medium text-[#585858] mb-1.5">{t.mfa.codeLabel}</label>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => onCodeChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void submitCode(); }}
                className="w-full h-12 px-4 rounded-xl border border-[#EDEDED] text-center text-[18px] font-mono tracking-[0.4em] text-[#333] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 focus:border-[#1F114C] transition"
                placeholder="000000"
                aria-label={t.mfa.codeLabel}
              />
            </div>

            <button
              onClick={submitCode}
              disabled={busy || code.length < 6}
              className="w-full h-11 rounded-xl bg-[#1F114C] text-white text-[13px] font-semibold hover:bg-[#2a1a5e] disabled:opacity-50 transition"
            >
              {busy ? t.mfa.verifying : mode === 'enroll' ? t.mfa.verify : t.mfa.continueBtn}
            </button>

            <div className="text-center">
              <a href="/dashboard" className="text-[13px] text-[#8B8B8B] hover:text-[#585858] hover:underline">{t.mfa.backToDashboard}</a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
