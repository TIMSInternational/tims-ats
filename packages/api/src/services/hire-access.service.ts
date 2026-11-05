import { getAppUrl, logger } from '@tims/shared';
import { sendEmail } from '../lib/ses';
import { generatePasswordSetupLink } from './staff-provisioning.service';
import { hireAccessEmail, type HireAccessEmailLocale } from './hire-access-email';

// ---------------------------------------------------------------------------
// Hire hand-off: how the new employee gets in (E-06 / B-07 / C-31)
// ---------------------------------------------------------------------------
// convertToEmployee links the new `users` row to a Supabase identity:
//   - a NEW identity was invited → Supabase already emailed its "set your password" invitation;
//   - an EXISTING identity was reused (every portal applicant has one) → Supabase sent nothing, so this
//     service emails a single-use set-password link (landing on /reset-password?setup=1) in Spanish.
// The outcome is returned to the hire screen, which tells HR exactly what was sent — and, when nothing
// could be sent, what the new employee must do instead (/forgot-password with the same email).

export type HireAccessOutcome =
  /** Brand-new identity: Supabase's invitation email went out. */
  | { kind: 'invitation_sent'; email: string }
  /** Existing identity: our set-password email was accepted by the mail provider. */
  | { kind: 'setup_link_sent'; email: string }
  /** Existing identity, but no link/email could be produced: staff must tell the hire to use /forgot-password. */
  | { kind: 'setup_link_failed'; email: string };

/** Bound for the email itself (the link request has its own bound in staff-provisioning). */
export const HIRE_ACCESS_EMAIL_TIMEOUT_MS = 4_000;

export interface DeliverHireAccessParams {
  email: string;
  invited: boolean;
  firstName: string;
  organizationName: string;
  jobTitle: string;
  startDate: Date | null;
  timeZone: string;
  contactEmail: string | null;
  locale: HireAccessEmailLocale;
}

export async function deliverHireAccess(p: DeliverHireAccessParams): Promise<HireAccessOutcome> {
  if (p.invited) return { kind: 'invitation_sent', email: p.email };

  try {
    const setupUrl = await generatePasswordSetupLink(p.email);
    if (!setupUrl) return { kind: 'setup_link_failed', email: p.email };

    const { subject, html } = hireAccessEmail({
      firstName: p.firstName,
      organizationName: p.organizationName,
      jobTitle: p.jobTitle,
      startDate: p.startDate,
      timeZone: p.timeZone,
      setupUrl,
      appUrl: getAppUrl(),
      email: p.email,
      contactEmail: p.contactEmail,
      locale: p.locale,
    });
    const sent = await sendEmail({
      to: p.email,
      subject,
      html,
      abortSignal: AbortSignal.timeout(HIRE_ACCESS_EMAIL_TIMEOUT_MS),
      replyTo: p.contactEmail,
    });
    return { kind: sent ? 'setup_link_sent' : 'setup_link_failed', email: p.email };
  } catch (error) {
    // The hire is already committed; never fail it over the email. Log no address or link.
    logger.warn(
      { component: 'hire-access', errName: error instanceof Error ? error.name : 'UnknownError' },
      'Hire access email could not be sent',
    );
    return { kind: 'setup_link_failed', email: p.email };
  }
}
