import { z } from 'zod';

// The mailbox the candidate portal's privacy panel names for data requests (access, correction, deletion). ONLY the
// organization's configured candidate contact (organizations.settings.candidateContactEmail): never its billing email,
// which is an accounts mailbox nobody there reads for data requests (owner decision 2026-11-11). Null when none is
// configured: the panel then says the organization has not published one. Candidate emails keep their own Reply-To
// chain (packages/api candidate-contact.ts); this is the portal panel only. Pure: no React, no server imports.
const contactEmailSchema = z.string().trim().toLowerCase().email().max(254);

export function candidatePrivacyContactEmail(settings: unknown): string | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
  const parsed = contactEmailSchema.safeParse((settings as Record<string, unknown>).candidateContactEmail);
  // A bare mailbox only (it is rendered in a mailto: link): never a display name, a list or CR/LF.
  return parsed.success && !/[\s<>"(),;:\\[\]?&=]/.test(parsed.data) ? parsed.data : null;
}
