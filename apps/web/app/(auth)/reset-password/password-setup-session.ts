type SessionResult = {
  data: { session: unknown | null };
  error: unknown | null;
};

const proofPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PasswordSetupAuth = {
  getSession: () => PromiseLike<SessionResult>;
  setSession: (tokens: { access_token: string; refresh_token: string }) => PromiseLike<SessionResult>;
};

function validToken(value: string | null, maxLength: number): value is string {
  return !!value && value.length <= maxLength && ![...value].some((character) => character.charCodeAt(0) < 32);
}

function rejectionKey(): string {
  const stableQuery = new URLSearchParams(window.location.search);
  for (const transient of ['code', 'error', 'error_code', 'error_description']) stableQuery.delete(transient);
  const suffix = stableQuery.toString();
  return `tims-password-setup-rejected:${window.location.pathname}${suffix ? `?${suffix}` : ''}`;
}

export async function establishPasswordSetupSession(auth: PasswordSetupAuth): Promise<boolean> {
  const query = new URLSearchParams(window.location.search);
  if (query.has('code') || query.has('error') || query.has('error_code') || query.has('error_description')) {
    window.sessionStorage.setItem(rejectionKey(), '1');
    for (const transient of ['code', 'error', 'error_code', 'error_description']) query.delete(transient);
    const suffix = query.toString();
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${suffix ? `?${suffix}` : ''}`);
    return false;
  }

  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const hasProviderError = fragment.has('error') || fragment.has('error_code') || fragment.has('error_description');
  const hasFragmentCredentials = fragment.has('access_token') || fragment.has('refresh_token');
  if (hasProviderError || hasFragmentCredentials) {
    const accessToken = fragment.get('access_token');
    const refreshToken = fragment.get('refresh_token');

    // Remove credentials before any user interaction or navigation. URL fragments
    // are not sent to the server, but they otherwise remain visible in history.
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
    if (
      hasProviderError ||
      !['invite', 'recovery'].includes(fragment.get('type') ?? '') ||
      !validToken(accessToken, 16_384) ||
      !validToken(refreshToken, 8_192)
    ) {
      window.sessionStorage.setItem(rejectionKey(), '1');
      return false;
    }

    const invite = await auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    if (invite.error || !invite.data.session) {
      window.sessionStorage.setItem(rejectionKey(), '1');
      return false;
    }
    window.sessionStorage.removeItem(rejectionKey());
    return true;
  }

  const recoveryProof = query.get('recovery');
  if (recoveryProof) {
    query.delete('recovery');
    const suffix = query.toString();
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${suffix ? `?${suffix}` : ''}`);
    if (!proofPattern.test(recoveryProof)) {
      window.sessionStorage.setItem(rejectionKey(), '1');
      return false;
    }
    try {
      const response = await fetch(`/api/auth/password-setup?nonce=${encodeURIComponent(recoveryProof)}`, {
        method: 'POST',
        cache: 'no-store',
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok || typeof data !== 'object' || data === null || !('valid' in data) || data.valid !== true) {
        window.sessionStorage.setItem(rejectionKey(), '1');
        return false;
      }
      const verified = await auth.getSession();
      if (verified.error || !verified.data.session) {
        window.sessionStorage.setItem(rejectionKey(), '1');
        return false;
      }
      window.sessionStorage.removeItem(rejectionKey());
      return true;
    } catch {
      window.sessionStorage.setItem(rejectionKey(), '1');
      return false;
    }
  }

  if (window.sessionStorage.getItem(rejectionKey()) === '1') return false;
  const existing = await auth.getSession();
  return !existing.error && !!existing.data.session;
}
