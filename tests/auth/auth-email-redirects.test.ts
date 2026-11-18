import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

// #50: every Supabase call that EMAILS a link (password reset, sign-up confirmation,
// magic link, invite) must build its redirect from the configured app origin
// (getAuthRedirectUrl / getAppUrl -> NEXT_PUBLIC_APP_URL), never window.location or the
// request Host header. OAuth redirects are deliberately excluded: they are a same-browser
// round-trip whose PKCE verifier lives on the current origin, and they send no email.

const root = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

const EMAIL_CALL_SITES: Array<{ file: string; call: RegExp }> = [
  { file: 'apps/web/app/(auth)/forgot-password/page.tsx', call: /resetPasswordForEmail\(/ },
  { file: 'apps/web/app/(auth)/register/register-form.tsx', call: /auth\.signUp\(/ },
  { file: 'apps/web/app/(portal)/careers/[orgSlug]/login/page.tsx', call: /signInWithOtp\(/ },
  { file: 'apps/web/app/accept-invitation/invitation-setup-api.ts', call: /resetPasswordForEmail\(/ },
  { file: 'packages/api/src/routers/platform/users.ts', call: /resetPasswordForEmail\(/ },
  { file: 'packages/api/src/services/staff-provisioning.service.ts', call: /inviteUserByEmail\(/ },
];

// The argument region of an email call: from the call to the end of its options object.
function callRegion(source: string, call: RegExp): string {
  const start = source.search(call);
  expect(start, 'email call site not found').toBeGreaterThanOrEqual(0);
  return source.slice(start, start + 600);
}

describe('auth email redirects derive from the configured app origin (#50)', () => {
  it.each(EMAIL_CALL_SITES)('$file builds its email redirect without window.location', ({ file, call }) => {
    const source = read(file);
    const region = callRegion(source, call);
    expect(region).not.toMatch(/window\.location/);
    expect(region).not.toMatch(/headers\.get\(['"]host['"]\)/i);
    expect(source).toMatch(/getAuthRedirectUrl|getAppUrl/);
  });

  it('no email-sending call anywhere in these files reads window.location.origin', () => {
    for (const { file } of EMAIL_CALL_SITES) {
      const source = read(file);
      for (const match of source.matchAll(/(resetPasswordForEmail|signInWithOtp|auth\.signUp|inviteUserByEmail)\(/g)) {
        const region = source.slice(match.index ?? 0, (match.index ?? 0) + 600);
        expect(region, `${file}: ${match[1]}`).not.toMatch(/window\.location\.origin/);
      }
    }
  });

  it('the reset landing page and callback that the links target exist', () => {
    expect(read('apps/web/app/(auth)/reset-password/page.tsx')).toMatch(/establishPasswordSetupSession/);
    const callback = read('apps/web/app/auth/callback/route.ts');
    expect(callback).toMatch(/exchangeCodeForSession/);
    expect(callback).toMatch(/new URL\('\/reset-password', origin\)/);
  });
});
