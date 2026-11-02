// Support contact address shown in the admin top bar.
//
// Read from NEXT_PUBLIC_SUPPORT_EMAIL (inlined into the client bundle at build
// time). When the variable is unset, blank or not a plain email address, the
// support entry is not rendered at all — the UI never falls back to a made-up
// address.

// Deliberately strict: a single local@domain.tld with no whitespace, quotes,
// angle brackets, parentheses or URL/query characters, so the value is safe to
// place in a `mailto:` href without encoding.
const SUPPORT_EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

const MAX_EMAIL_LENGTH = 254;

export function resolveSupportEmail(raw: string | undefined | null): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (value.length === 0 || value.length > MAX_EMAIL_LENGTH) return null;
  return SUPPORT_EMAIL_PATTERN.test(value) ? value : null;
}

export function getSupportEmail(): string | null {
  // Must stay a direct `process.env.NEXT_PUBLIC_*` member access so Next.js
  // inlines it into the client bundle.
  return resolveSupportEmail(process.env.NEXT_PUBLIC_SUPPORT_EMAIL);
}
