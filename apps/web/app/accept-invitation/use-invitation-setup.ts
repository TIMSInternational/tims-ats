'use client';

import { useEffect, useState } from 'react';
import { z } from 'zod';
import type { Session } from '@supabase/supabase-js';
import { createSupabaseBrowserClient } from '@tims/auth/client';
import type { copy } from './invitation-copy';
import {
  invitationSchema,
  invitationRecovery,
  invitationSocialSignIn,
  isInvitationRefused,
  resultSchema,
  SetupRequestError,
  setupRequest,
  type Invitation,
} from './invitation-setup-api';

type InvitationCopy = (typeof copy)['es'];

/** State and actions of the invitation page; the component only renders them. */
export function useInvitationSetup(token: string, t: InvitationCopy) {
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
      else if (result.outcome === 'sign_in_required') {
        // The session was not accepted (e.g. an SSO email that is not verified): offer password and recovery.
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
      const { error: recoveryError } = await invitationRecovery(invitation.email, token);
      if (recoveryError) setError(t.error);
      else setNotice(t.recovery);
    });
  }

  function social(provider: 'google' | 'azure') {
    return run(async () => {
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
