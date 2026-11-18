import 'server-only';
import { z } from 'zod';

// The organization's own mailbox for candidates, shown in the PUBLIC privacy notice's "Cómo ejercer sus
// derechos" section: organizations.settings.candidateContactEmail (jsonb, set per tenant), otherwise NONE —
// the notice then tells the candidate to use the organization's official channels.
//
// Deliberately narrower than candidate emails, which fall back to billing_email for their contact line and
// Reply-To: those reach one applicant, while this page is anonymous and enumerable by slug, and billing_email
// is often a person's account address (organization creation defaults it to the admin's email; self-service
// sign-up stores the signing-up user's). Only an address the organization configured for candidates is
// published.
//
// There is no platform-wide default and no address in the i18n catalogues: the notice is shared by every
// organization, so a candidate of one organization must never be sent to a mailbox of another organization
// or of the platform vendor.

// Zod's email format admits a bare mailbox only — no display name, list, whitespace or CR/LF — which is
// what a mailto: link needs (the tests pin that).
const contactEmailSchema = z.string().trim().toLowerCase().email().max(254);

/** The mailbox this organization configured for candidates, or null when it has none. */
export function publicCandidateContactEmail(settings: unknown): string | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
  const parsed = contactEmailSchema.safeParse((settings as Record<string, unknown>).candidateContactEmail);
  return parsed.success ? parsed.data : null;
}
