type SessionResult = {
  data: { session: unknown | null };
  error: unknown | null;
};

export type PasswordSetupAuth = {
  getSession: () => PromiseLike<SessionResult>;
  setSession: (tokens: { access_token: string; refresh_token: string }) => PromiseLike<SessionResult>;
};

function validToken(value: string | null, maxLength: number): value is string {
  return !!value && value.length <= maxLength && ![...value].some((character) => character.charCodeAt(0) < 32);
}

export async function establishPasswordSetupSession(auth: PasswordSetupAuth): Promise<boolean> {
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const hasFragmentCredentials = fragment.has('access_token') || fragment.has('refresh_token');
  if (hasFragmentCredentials) {
    const accessToken = fragment.get('access_token');
    const refreshToken = fragment.get('refresh_token');

    // Remove credentials before any user interaction or navigation. URL fragments
    // are not sent to the server, but they otherwise remain visible in history.
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
    if (fragment.get('type') !== 'invite') return false;
    if (!validToken(accessToken, 16_384) || !validToken(refreshToken, 8_192)) return false;

    const invite = await auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    return !invite.error && !!invite.data.session;
  }

  const existing = await auth.getSession();
  return !existing.error && !!existing.data.session;
}
