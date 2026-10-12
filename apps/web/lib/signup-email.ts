import { MAX_ORG_DOMAIN_LENGTH, MAX_ORG_EMAIL_LENGTH, ORG_DOMAIN_PATTERN } from '@tims/shared';

/**
 * #213: the self-serve signup in `app/auth/callback/route.ts` writes the identity provider's email into
 * `organizations.billing_email` and `users.email`, and derives the default company name from the email's
 * domain. Owner decision: REJECT an out-of-bounds value, never truncate it (a truncated address is a
 * different, possibly someone else's, mailbox). The bounds are the same ones `organization.create/update`
 * enforce (`packages/shared/src/validators/organization.ts`).
 *
 * The value is judged exactly as it will be stored — no trimming or case-folding here.
 */
export type SignupEmailRejection = 'email_too_long' | 'email_malformed' | 'domain_too_long' | 'domain_invalid';

export type SignupEmailCheck = { ok: true; domain: string } | { ok: false; reason: SignupEmailRejection };

export function checkSignupEmail(email: string): SignupEmailCheck {
  if (email.length > MAX_ORG_EMAIL_LENGTH) return { ok: false, reason: 'email_too_long' };
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return { ok: false, reason: 'email_malformed' };
  const domain = email.slice(at + 1);
  // Implied by the 254 email bound today (the domain can be at most 252 chars); kept so the domain bound
  // holds on its own if the email bound is ever relaxed.
  if (domain.length > MAX_ORG_DOMAIN_LENGTH) return { ok: false, reason: 'domain_too_long' };
  if (!ORG_DOMAIN_PATTERN.test(domain)) return { ok: false, reason: 'domain_invalid' };
  return { ok: true, domain };
}

/** The `?error=` code the callback redirects to. One generic code: the reason goes to the log, not the URL. */
export const SIGNUP_EMAIL_REJECTED_ERROR = 'signup_email_invalid';
