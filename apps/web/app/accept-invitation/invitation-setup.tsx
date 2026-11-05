'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { isMfaPrivileged } from '@tims/shared';
import { isSsoSignInOffered } from '../../lib/auth/sso-sign-in';
import { copy } from './invitation-copy';
import { InvitationHeader } from './invitation-header';
import { InvitationSummary } from './invitation-summary';
import { InvitationNotice } from './invitation-notice';
import { InvitationReady } from './invitation-ready';
import { InvitationExistingControls } from './invitation-existing-controls';
import { invitationField as field } from './invitation-styles';
import { invitationUnavailable } from './invitation-setup-api';
import { useInvitationSetup } from './use-invitation-setup';

export function InvitationSetup() {
  const token = useSearchParams().get('token') ?? '';
  const [locale, setLocale] = useState<'es' | 'en'>('es');
  const t = copy[locale];
  const setup = useInvitationSetup(token, t);
  const { invitation, existing, busy, complete, sessionToken, error, notice, fields } = setup;
  // The pilot hides Google / Microsoft sign-in everywhere (one switch: isSsoSignInOffered), so invitees set a
  // password they can reuse at /login.
  const ssoEnabled = isSsoSignInOffered();
  const needsMfa = !!invitation?.roleSlug && isMfaPrivileged({ roles: [invitation.roleSlug], isPlatformOwner: false });
  const errorBox = error && (
    <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
      {error}
    </p>
  );

  return (
    <main className="min-h-screen bg-[#f4f3f8] px-4 py-12 text-[#241641]">
      <div className="mx-auto max-w-lg">
        <InvitationHeader language={t.language} toggle={() => setLocale(locale === 'es' ? 'en' : 'es')} />
        <section className="rounded-3xl border border-white bg-white p-7 shadow-sm sm:p-10">
          <div className="mb-6 h-1 w-12 rounded-full bg-[#dd0c15]" />
          <h1 className="text-3xl font-semibold tracking-tight">{complete ? t.ready : t.welcome}</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">{complete ? t.readyText : t.subtitle}</p>
          {setup.loading ? (
            <p role="status" className="mt-8">
              {t.loading}
            </p>
          ) : complete ? (
            <InvitationReady open={t.open} mfaNext={needsMfa ? t.mfaNext : undefined} />
          ) : setup.loadFailed ? (
            <InvitationNotice message={t.loadFailed} action={t.retry} onAction={setup.retryLoad} />
          ) : !invitation || invitationUnavailable(invitation) ? (
            <div>
              <p role="alert" className="mt-8 text-sm text-red-700">
                {t.unavailable}
              </p>
              <a href="/login" className="mt-4 block text-sm underline">
                {t.signIn}
              </a>
            </div>
          ) : setup.otherSession !== undefined ? (
            <>
              <InvitationSummary invitation={invitation} locale={locale} noRole={t.noRole} expires={t.expires} />
              <InvitationNotice
                message={t.otherSession.replace('{email}', setup.otherSession)}
                action={t.otherSessionContinue}
                onAction={() => void setup.leaveOtherSession()}
                busy={busy}
              />
              {errorBox && <div className="mt-4">{errorBox}</div>}
            </>
          ) : (
            <>
              <InvitationSummary invitation={invitation} locale={locale} noRole={t.noRole} expires={t.expires} />
              <p className="mb-5 text-sm leading-6 text-slate-600">{existing ? t.existing : t.newUser}</p>
              <form onSubmit={setup.submit} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <label className="space-y-2 text-sm">
                    {t.first}
                    <input
                      className={field}
                      value={fields.firstName}
                      onChange={(e) => fields.setFirstName(e.target.value)}
                      required
                      maxLength={100}
                      autoComplete="given-name"
                    />
                  </label>
                  <label className="space-y-2 text-sm">
                    {t.last}
                    <input
                      className={field}
                      value={fields.lastName}
                      onChange={(e) => fields.setLastName(e.target.value)}
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
                      value={fields.secret}
                      onChange={(e) => fields.setSecret(e.target.value)}
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
                        value={fields.confirmation}
                        onChange={(e) => fields.setConfirmation(e.target.value)}
                        required
                        minLength={12}
                        maxLength={128}
                        autoComplete="new-password"
                      />
                    </label>
                    <p className="text-xs text-slate-500">{t.policy}</p>
                  </>
                )}
                {errorBox}
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
                  onClick={setup.toggleExisting}
                >
                  {existing ? t.createInstead : t.signIn}
                </button>
                {existing && !sessionToken && (
                  <InvitationExistingControls
                    busy={busy}
                    ssoEnabled={ssoEnabled}
                    help={ssoEnabled ? t.existingHelpSso : t.existingHelp}
                    forgot={t.forgot}
                    continueGoogle={t.continueGoogle}
                    continueMicrosoft={t.continueMicrosoft}
                    onRecover={() => void setup.recover()}
                    onSocial={(provider) => void setup.social(provider)}
                  />
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
