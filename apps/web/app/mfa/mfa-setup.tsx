'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@tims/auth/client';
import { useI18n } from '../../lib/i18n';
import { mfaMode, type MfaMode, type Aal } from '../../lib/mfa';
import { takePostLoginDestination } from '../../lib/auth/post-login-destination';
import { Button } from '../../components/button';
import { TEXT_LINK_CLASSES } from '../../components/button-styles';
import { Field } from '../../components/field';
import { TextInput } from '../../components/text-input';
import { AUTH_ERROR_CLASSES, AUTH_NOTICE_CLASSES } from '../(auth)/auth-card';
import { MfaEnabledPanel } from './mfa-enabled-panel';
import { MfaEnrollSecret } from './mfa-enroll-secret';
import { MfaSuccessIcon } from './mfa-success-icon';

// Two-factor (TOTP) setup + step-up, backed by Supabase Auth MFA. Three modes,
// derived purely in lib/mfa.ts:
//   enroll    — no verified factor: show QR + secret, verify a code to activate
//   challenge — verified factor but session is aal1: step up with a code
//   enabled   — verified factor and session is aal2: manage / disable
// `required` (computed on the server with the gate's own rule) = the user cannot skip MFA: the page
// says why, offers "Cerrar sesión" instead of a "Volver al panel" that would loop, and never offers
// "Desactivar". A successful code always continues to the app (or back to `returnTo`).
export function MfaSetup({ returnTo, required }: { returnTo?: string; required: boolean }) {
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
  const [confirmingDisable, setConfirmingDisable] = useState(false);
  const [redirecting, setRedirecting] = useState(false);

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
    const verified = (factorsData?.totp ?? []).filter((f: { status: string }) => f.status === 'verified');
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
    // Enrollment and step-up both continue to the app (or back to the invitation / password step that
    // sent the user here), never onto the management screen and its "Desactivar" button. A user forced
    // here by the gate right after signing in continues to the page they were signing in to.
    setRedirecting(true);
    router.push(returnTo ?? (required ? takePostLoginDestination() : null) ?? '/dashboard');
    router.refresh();
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
    setConfirmingDisable(false);
    setFactorId(null);
    await refresh();
    router.refresh();
  };

  const onCodeChange = (v: string) => setCode(v.replace(/\D/g, '').slice(0, 6));

  // Under enforcement "/dashboard" sends the user straight back here, so the only real exit is signing
  // out. A plain <a> (not next/link): /logout is a GET route handler and must never be prefetched.
  const exitLink =
    required || returnTo ? (
      <a href="/logout" className={`${TEXT_LINK_CLASSES} min-h-7`}>
        {t.mfa.signOut}
      </a>
    ) : (
      <a href="/dashboard" className={`${TEXT_LINK_CLASSES} min-h-7`}>
        {t.mfa.backToDashboard}
      </a>
    );

  // Enrollment could not create a factor: no QR to scan, so no code field either — say so and offer a
  // retry of the same load (feedback.md › Best practices).
  const enrollFailed = mode === 'enroll' && !qr;

  return (
    <div className="w-full max-w-md">
      <div className="mb-6 text-center">
        <div className="mb-4 inline-flex size-14 items-center justify-center rounded-2xl bg-brand">
          <svg
            className="size-7 text-white"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
          </svg>
        </div>
        <h1 className="font-display text-title font-semibold text-brand">{t.mfa.title}</h1>
        <p className="mx-auto mt-1 max-w-prose text-body text-muted">{t.mfa.subtitle}</p>
      </div>

      <div className="rounded-2xl bg-white p-6 shadow-card sm:p-8">
        {loading ? (
          <div aria-busy="true" className="flex flex-col items-center gap-4">
            <p role="status" className="sr-only">
              {t.mfa.loading}
            </p>
            <div className="size-44 animate-pulse rounded-xl bg-surface motion-reduce:animate-none" />
            <div className="h-11 w-full animate-pulse rounded-lg bg-surface motion-reduce:animate-none" />
          </div>
        ) : redirecting ? (
          <div className="text-center" role="status">
            <MfaSuccessIcon />
            <h2 className="mb-1 text-heading font-semibold text-brand">{t.mfa.enabledTitle}</h2>
            <p className="text-body text-secondary">{t.mfa.redirecting}</p>
          </div>
        ) : mode === 'enabled' ? (
          <MfaEnabledPanel
            required={required}
            error={error}
            busy={busy}
            confirming={confirmingDisable}
            onConfirming={setConfirmingDisable}
            onDisable={() => void disable()}
          />
        ) : enrollFailed ? (
          <div className="space-y-4 text-center">
            <div role="alert">
              <h2 className="mb-1 text-heading font-semibold text-primary">{t.mfa.enrollFailedTitle}</h2>
              <p className="text-body text-secondary">{t.mfa.enrollFailedDesc}</p>
            </div>
            <Button variant="secondary" size="lg" fullWidth disabled={loading} onClick={() => void refresh()}>
              {t.common.retry}
            </Button>
            <div>{exitLink}</div>
          </div>
        ) : (
          <div className="space-y-4">
            {required && (
              <div role="status" className={AUTH_NOTICE_CLASSES}>
                {t.mfa.enforcedNotice}
              </div>
            )}
            <div>
              <h2 className="mb-1 text-heading font-semibold text-brand">
                {mode === 'enroll' ? t.mfa.enrollTitle : t.mfa.challengeTitle}
              </h2>
              <p className="text-body text-secondary">{mode === 'enroll' ? t.mfa.enrollScan : t.mfa.challengeDesc}</p>
            </div>

            {mode === 'enroll' && qr && <MfaEnrollSecret qr={qr} secret={secret} />}

            {error && (
              <div role="alert" className={AUTH_ERROR_CLASSES}>
                {error}
              </div>
            )}

            <Field label={t.mfa.codeLabel} id="mfa-code">
              <TextInput
                size="lg"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => onCodeChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submitCode();
                }}
                className="text-center font-mono tracking-[0.4em]"
                placeholder="000000"
              />
            </Field>

            <Button
              size="lg"
              fullWidth
              onClick={() => void submitCode()}
              loading={busy}
              loadingLabel={t.mfa.verifying}
              disabled={code.length < 6}
            >
              {mode === 'enroll' ? t.mfa.verify : t.mfa.continueBtn}
            </Button>

            <div className="text-center">{exitLink}</div>
          </div>
        )}
      </div>
    </div>
  );
}
