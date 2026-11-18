// ---------------------------------------------------------------------------
// The organization's contact mailbox for candidates (pure)
// ---------------------------------------------------------------------------
// Candidate emails (application received, interview invite/update/cancel) print "Si tiene preguntas,
// escríbanos a …" and set Reply-To to the same address. The address is the organization's own:
//   1. organizations.settings.candidateContactEmail (jsonb, set per tenant), then
//   2. organizations.billing_email,
//   3. otherwise NONE — the contact line is omitted and no Reply-To is set.
// There is deliberately no platform-wide default: a candidate of one organization must never be sent to
// a mailbox of another organization or of the vendor.

import { z } from 'zod';

const contactEmailSchema = z.string().trim().toLowerCase().email().max(254);

export type CandidateContactSource = { settings?: unknown; billingEmail?: string | null };

function validEmail(value: unknown): string | null {
  const parsed = contactEmailSchema.safeParse(value);
  // A header-safe bare mailbox only (the same shape lib/mime.ts accepts): never a display name, a list
  // or CR/LF.
  return parsed.success && !/[\s<>"(),;:\\[\]]/.test(parsed.data) ? parsed.data : null;
}

/** The mailbox candidates of this organization may write to, or null when it has none configured. */
export function candidateContactEmail(org: CandidateContactSource | null | undefined): string | null {
  if (!org) return null;
  const settings = org.settings;
  if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
    const configured = validEmail((settings as Record<string, unknown>).candidateContactEmail);
    if (configured) return configured;
  }
  return validEmail(org.billingEmail);
}
