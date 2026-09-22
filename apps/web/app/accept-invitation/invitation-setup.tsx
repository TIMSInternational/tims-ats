'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { z } from 'zod';
import type { Session } from '@supabase/supabase-js';
import { createSupabaseBrowserClient } from '@tims/auth/client';
import { copy } from './invitation-copy';
import { InvitationHeader } from './invitation-header';
import { InvitationSummary } from './invitation-summary';
import { invitationField as field } from './invitation-styles';
import {
  invitationSchema,
  invitationRecovery,
  invitationSocialSignIn,
  invitationUnavailable,
  resultSchema,
  SetupRequestError,
  setupRequest,
  type Invitation,
} from './invitation-setup-api';

export function InvitationSetup() {
  const token = useSearchParams().get('token') ?? '';
  const [locale, setLocale] = useState<'es' | 'en'>('es');
  const t = copy[locale];
  const [invitation, setInvitation] = useState<Invitation>();
  const [loading, setLoading] = useState(true);
  const [existing, setExisting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [secret, setSecret] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [sessionToken, setSessionToken] = useState<string>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let current = true;
    if (!z.string().uuid().safeParse(token).success) {
      setLoading(false);
      return;
    }
    setupRequest('preview', { token })
      .then((value) => {
        const result = invitationSchema.parse(value);
        if (!current) return;
        setInvitation(result);
        setExisting(result.accountExists);
        void createSupabaseBrowserClient()
          .auth.getSession()
          .then(({ data }: { data: { session: Session | null } }) => {
            if (current && data.session?.user.email?.toLowerCase() === result.email.toLowerCase()) {
              setSessionToken(data.session.access_token);
              setExisting(true);
            }
          });
      })
      .catch(() => undefined)
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [token]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!invitation || busy) return;
    setError('');
    setNotice('');
    if (!existing && secret !== confirmation) {
      setError(t.mismatch);
      return;
    }
    setBusy(true);
    try {
      if (!existing) {
        const registered = resultSchema.parse(await setupRequest('register', { token, password: secret }));
        if (registered.outcome !== 'account_created') {
          setExisting(true);
          setError(t.signinRequired);
          return;
        }
        setExisting(true);
      }
      const auth = createSupabaseBrowserClient();
      const latest = await auth.auth.getSession();
      let accessToken =
        latest.data.session?.user.email?.toLowerCase() === invitation.email.toLowerCase()
          ? latest.data.session.access_token
          : undefined;
      if (!accessToken) {
        // Session expiry or logout in another tab must reveal a recoverable sign-in state.
        setSessionToken(undefined);
        const signedIn = await auth.auth.signInWithPassword({ email: invitation.email, password: secret });
        setSecret('');
        setConfirmation('');
        if (signedIn.error || !signedIn.data.session) {
          setError(t.signinRequired);
          return;
        }
        accessToken = signedIn.data.session.access_token;
        setSessionToken(accessToken);
      }
      const result = resultSchema.parse(await setupRequest('complete', { token, firstName, lastName }, accessToken));
      if (result.outcome === 'complete') setComplete(true);
      else
        setError(
          result.outcome === 'wrong_account' ? t.wrong : result.outcome === 'access_conflict' ? t.conflict : t.error,
        );
    } catch (failure) {
      if (failure instanceof SetupRequestError && failure.code === 'mfa_required') {
        window.location.assign(`/mfa?returnTo=${encodeURIComponent(`/accept-invitation?token=${token}`)}`);
        return;
      }
      setError(t.error);
    } finally {
      setBusy(false);
    }
  }

  async function recover() {
    if (!invitation || busy) return;
    setBusy(true);
    setError('');
    try {
      const { error: recoveryError } = await invitationRecovery(invitation.email, token);
      if (recoveryError) {
        setError(t.error);
        return;
      }
      setNotice(t.recovery);
    } catch {
      setError(t.error);
    } finally {
      setBusy(false);
    }
  }

  async function social(provider: 'google' | 'azure') {
    setBusy(true);
    setError('');
    const { error: failure } = await invitationSocialSignIn(provider, token);
    if (failure) {
      setError(t.error);
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f4f3f8] px-4 py-12 text-[#241641]">
      <div className="mx-auto max-w-lg">
        <InvitationHeader language={t.language} toggle={() => setLocale(locale === 'es' ? 'en' : 'es')} />
        <section className="rounded-3xl border border-white bg-white p-7 shadow-sm sm:p-10">
          <div className="mb-6 h-1 w-12 rounded-full bg-[#dd0c15]" />
          <h1 className="text-3xl font-semibold tracking-tight">{complete ? t.ready : t.welcome}</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">{complete ? t.readyText : t.subtitle}</p>
          {loading ? (
            <p role="status" className="mt-8">
              {t.loading}
            </p>
          ) : complete ? (
            <a
              href="/dashboard"
              className="mt-8 block rounded-xl bg-[#241641] px-5 py-3 text-center font-medium text-white"
            >
              {t.open}
            </a>
          ) : !invitation || invitationUnavailable(invitation) ? (
            <div>
              <p role="alert" className="mt-8 text-sm text-red-700">
                {t.unavailable}
              </p>
              <a href="/login" className="mt-4 block text-sm underline">
                {t.signIn}
              </a>
            </div>
          ) : (
            <>
              <InvitationSummary invitation={invitation} locale={locale} noRole={t.noRole} expires={t.expires} />
              <p className="mb-5 text-sm leading-6 text-slate-600">{existing ? t.existing : t.newUser}</p>
              <form onSubmit={submit} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <label className="space-y-2 text-sm">
                    {t.first}
                    <input
                      className={field}
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      required
                      maxLength={100}
                      autoComplete="given-name"
                    />
                  </label>
                  <label className="space-y-2 text-sm">
                    {t.last}
                    <input
                      className={field}
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      required
                      maxLength={100}
                      autoComplete="family-name"
                    />
                  </label>
                </div>
                {!sessionToken && (
                  <label className="block space-y-2 text-sm">
                    {t.secret}
                    <input
                      className={field}
                      type="password"
                      value={secret}
                      onChange={(e) => setSecret(e.target.value)}
                      required
                      minLength={existing ? 1 : 12}
                      maxLength={128}
                      autoComplete={existing ? 'current-password' : 'new-password'}
                    />
                  </label>
                )}
                {!existing && (
                  <>
                    <label className="block space-y-2 text-sm">
                      {t.confirm}
                      <input
                        className={field}
                        type="password"
                        value={confirmation}
                        onChange={(e) => setConfirmation(e.target.value)}
                        required
                        minLength={12}
                        maxLength={128}
                        autoComplete="new-password"
                      />
                    </label>
                    <p className="text-xs text-slate-500">{t.policy}</p>
                  </>
                )}
                {error && (
                  <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
                    {error}
                  </p>
                )}
                {notice && (
                  <p role="status" className="rounded-lg bg-violet-50 p-3 text-sm">
                    {notice}
                  </p>
                )}
                <button
                  disabled={busy}
                  type="submit"
                  className="w-full rounded-xl bg-[#241641] px-5 py-3 font-medium text-white disabled:opacity-50"
                >
                  {busy ? t.working : sessionToken ? t.finish : existing ? t.join : t.create}
                </button>
                <button
                  disabled={busy}
                  type="button"
                  className="w-full text-sm underline"
                  onClick={() => {
                    setExisting(!existing);
                    setSessionToken(undefined);
                    setError('');
                  }}
                >
                  {existing ? t.createInstead : t.signIn}
                </button>
                {existing && !sessionToken && (
                  <>
                    <button disabled={busy} type="button" className="w-full text-sm underline" onClick={recover}>
                      {t.forgot}
                    </button>
                    <div className="grid grid-cols-2 gap-3">
                      <button type="button" disabled={busy} className={field} onClick={() => social('google')}>
                        Google
                      </button>
                      <button type="button" disabled={busy} className={field} onClick={() => social('azure')}>
                        Microsoft
                      </button>
                    </div>
                  </>
                )}
              </form>
            </>
          )}
        </section>
        <p className="mt-6 text-center text-xs leading-5 text-slate-500">{t.support}</p>
      </div>
    </main>
  );
}
