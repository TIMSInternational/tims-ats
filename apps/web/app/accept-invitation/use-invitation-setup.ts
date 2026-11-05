'use client';

import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import type { Session } from '@supabase/supabase-js';
import { createSupabaseBrowserClient } from '@tims/auth/client';
import type { copy } from './invitation-copy';
import type { AuthCaptcha } from '../../lib/auth/use-auth-captcha';
import {
  invitationSchema,
  invitationPasswordSignIn,
  invitationRecovery,
  invitationSocialSignIn,
  isInvitationRefused,
  resultSchema,
  SetupRequestError,
  setupRequest,
  type Invitation,
} from './invitation-setup-api';

type InvitationCopy = (typeof copy)['es'];
type Adoption = { status: 'adopted' } | { status: 'other'; email: string } | { status: 'failed' };

/** State and actions of the invitation page; the component only renders them. */
export function useInvitationSetup(token: string, t: InvitationCopy, captcha: AuthCaptcha) {
  const [invitation, setInvitation] = useState<Invitation>();
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [otherSession, setOtherSession] = useState<string>();
  const [existing, setExisting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [secret, setSecret] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [sessionToken, setSessionToken] = useState<string>();
  // Every access token the API refused (sign_in_required) on this page: none is ever offered again, however many
  // refusals follow (the browser can still hold an older refused one while a newer isolated sign-in is refused).
  const rejectedTokens = useRef(new Set<string>());
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
            if (!current || !data.session) return;
            if (data.session.user.email?.toLowerCase() === result.email.toLowerCase()) {
              setSessionToken(data.session.access_token);
              setExisting(true);
            } else {
              // Continuing would silently replace someone else's session (e.g. an admin testing an invite).
              setOtherSession(data.session.user.email ?? '');
            }
          });
      })
      // A refused token is "unavailable"; anything else (network, 5xx, rate limit) can be retried.
      .catch((failure: unknown) => {
        if (current && !isInvitationRefused(failure)) setLoadFailed(true);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [token, attempt]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch {
      setError(t.error);
    } finally {
      setBusy(false);
    }
  }

  function retryLoad() {
    setLoadFailed(false);
    setLoading(true);
    setAttempt((value) => value + 1);
  }

  /**
   * The email of a session in this browser that belongs to someone OTHER than the invitee, if any. Checked
   * again before every action that would replace it, since another tab can sign in after the preview.
   */
  async function otherAccount(): Promise<string | undefined> {
    if (!invitation) return undefined;
    const { data } = await createSupabaseBrowserClient().auth.getSession();
    const session = data.session;
    if (!session || session.user.email?.toLowerCase() === invitation.email.toLowerCase()) return undefined;
    return session.user.email ?? '';
  }

  /**
   * Makes a session the API accepted the browser's session, unless another account is signed in by now. Between
   * that check and the write (setSession performs one Supabase user lookup) a sign-in from another tab can still
   * be replaced: Supabase's shared cookie storage has no compare-and-set. This and the explicit "sign out that
   * session" button are the only writes this page itself makes to the browser's session. (Google / Microsoft
   * are checked before leaving for the provider; the auth callback then stores what the provider returns.)
   */
  async function adopt(session: Session): Promise<Adoption> {
    try {
      const other = await otherAccount();
      if (other !== undefined) return { status: 'other', email: other };
      const { error: adoptError } = await createSupabaseBrowserClient().auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      });
      return adoptError ? { status: 'failed' } : { status: 'adopted' };
    } catch {
      return { status: 'failed' };
    }
  }

  /** Signs the OTHER account out of this browser only (never its sessions elsewhere), then continues. */
  function leaveOtherSession() {
    return run(async () => {
      const { error: signOutError } = await createSupabaseBrowserClient().auth.signOut({ scope: 'local' });
      if (signOutError) setError(t.error);
      else setOtherSession(undefined);
    });
  }

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
      const other = await otherAccount();
      if (other !== undefined) {
        // Ask first: continuing would sign the invitee in over that account.
        setOtherSession(other);
        return;
      }
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
      const current = latest.data.session;
      if (current && current.user.email?.toLowerCase() !== invitation.email.toLowerCase()) {
        // Someone signed in from another tab while a request was in flight: ask before replacing them.
        setOtherSession(current.user.email ?? '');
        return;
      }
      let accessToken = current && !rejectedTokens.current.has(current.access_token) ? current.access_token : undefined;
      // A password sign-in is held outside the browser's session (invitationPasswordSignIn) until the API accepts
      // it: an account that signs in from another tab while these requests are in flight is not overwritten by
      // them, and a refused sign-in is never stored. Only adopt() writes it, with the residual window noted there.
      let pending: Session | undefined;
      if (!accessToken) {
        // Session expiry or logout in another tab must reveal a recoverable sign-in state.
        setSessionToken(undefined);
        const captchaOption = captcha.tokenOption();
        captcha.reset(); // single-use (C-34)
        const options = captchaOption.captchaToken ? { options: captchaOption } : {};
        const signedIn = await invitationPasswordSignIn({ email: invitation.email, password: secret, ...options });
        setSecret('');
        setConfirmation('');
        if (signedIn.error || !signedIn.data.session) {
          setError(t.signinRequired);
          return;
        }
        pending = signedIn.data.session;
        accessToken = pending.access_token;
      }
      let completion: unknown;
      try {
        completion = await setupRequest('complete', { token, firstName, lastName }, accessToken);
      } catch (failure) {
        if (pending && failure instanceof SetupRequestError && failure.code === 'mfa_required') {
          // Two-step setup (/mfa) runs on the browser's session, so adopt it first (not over another account).
          const adoption = await adopt(pending);
          if (adoption.status === 'other') {
            setOtherSession(adoption.email);
            return;
          }
          if (adoption.status === 'failed') {
            setError(t.error);
            return;
          }
        }
        throw failure;
      }
      const result = resultSchema.parse(completion);
      if (result.outcome === 'complete') {
        // Access is granted either way. If another account signed in meanwhile it is kept, and the invitee signs in
        // with these credentials later, as the ready screen says.
        if (pending) await adopt(pending);
        setComplete(true);
      } else if (result.outcome === 'sign_in_required') {
        // The session was not accepted (e.g. an SSO email that is not verified): never use it again, so the next
        // submit authenticates with the password, and offer password and recovery. Nothing is signed out: a refused
        // password sign-in never reached the browser's session, and a refused browser session belongs to the
        // invitee and is replaced when a later sign-in is adopted. So an account that signed in meanwhile is not
        // signed out by this page.
        rejectedTokens.current.add(accessToken);
        setSessionToken(undefined);
        setExisting(true);
        setError(t.signinRequired);
      } else {
        const known: Record<string, string> = {
          wrong_account: t.wrong,
          access_conflict: t.conflict,
          unavailable: t.unavailable,
        };
        setError(known[result.outcome] ?? t.error);
      }
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

  function recover() {
    if (!invitation || busy) return Promise.resolve();
    return run(async () => {
      const option = captcha.tokenOption();
      captcha.reset(); // single-use Turnstile token (C-34)
      const { error: recoveryError } = await invitationRecovery(invitation.email, token, option);
      if (recoveryError) setError(t.error);
      else setNotice(t.recovery);
    });
  }

  function social(provider: 'google' | 'azure') {
    return run(async () => {
      const other = await otherAccount();
      if (other !== undefined) {
        setOtherSession(other);
        return;
      }
      const { error: failure } = await invitationSocialSignIn(provider, token);
      if (failure) setError(t.error);
    });
  }

  function toggleExisting() {
    setExisting(!existing);
    setSessionToken(undefined);
    setError('');
  }

  return {
    invitation,
    loading,
    loadFailed,
    otherSession,
    existing,
    busy,
    complete,
    sessionToken,
    error,
    notice,
    fields: { firstName, setFirstName, lastName, setLastName, secret, setSecret, confirmation, setConfirmation },
    retryLoad,
    leaveOtherSession,
    submit,
    recover,
    social,
    toggleExisting,
  };
}
