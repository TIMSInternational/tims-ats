'use client';

import { useCallback, useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@tims/auth/client';

// E-19 / issue #410: a candidate sign-in must never silently replace a session already open in this browser
// (a recruiter testing the careers portal would be signed out of the staff app without warning). Before an
// email is sent and before a code is verified, the page asks whether another account is signed in; if so it
// shows "Tiene una sesión abierta como {email}" and only continues after an explicit sign-out. /auth/callback
// does the same for the emailed link (?error=open_session), which this hook reads on mount.

/** The email of a session open in this browser for an account other than `address`, or null. */
export async function otherOpenSessionEmail(address: string | null): Promise<string | null> {
  try {
    const { data } = await createSupabaseBrowserClient().auth.getSession();
    if (!data.session) return null;
    const current = data.session.user.email ?? '';
    if (address && current.toLowerCase() === address.trim().toLowerCase()) return null;
    return current;
  } catch {
    // No session information is not a reason to block a sign-in.
    return null;
  }
}

export function useOpenSession(fromCallback: boolean) {
  // The other account's email while the warning is shown, else null.
  const [openSession, setOpenSession] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [leaveFailed, setLeaveFailed] = useState(false);

  useEffect(() => {
    if (!fromCallback) return;
    let current = true;
    void otherOpenSessionEmail(null).then((other) => {
      if (current && other !== null) setOpenSession(other);
    });
    return () => {
      current = false;
    };
  }, [fromCallback]);

  /** True (and the warning shown) when another account is signed in; the caller stops there. */
  const blockedBy = useCallback(async (address: string): Promise<boolean> => {
    const other = await otherOpenSessionEmail(address);
    if (other === null) return false;
    setOpenSession(other);
    return true;
  }, []);

  const leave = useCallback(async () => {
    setLeaving(true);
    setLeaveFailed(false);
    try {
      const { error } = await createSupabaseBrowserClient().auth.signOut({ scope: 'local' });
      if (error) setLeaveFailed(true);
      else setOpenSession(null);
    } catch {
      setLeaveFailed(true);
    } finally {
      setLeaving(false);
    }
  }, []);

  return { openSession, blockedBy, leave, leaving, leaveFailed };
}
