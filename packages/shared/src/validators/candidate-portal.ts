import { z } from 'zod';

// The fields a signed-in candidate may correct about themself in the candidate portal ("Mis datos").
// The email is NOT editable: it is the portal identity (the Supabase session email), never input.
// Same bounds as the public application form (packages/api/src/routers/portal.ts applyToVacancy).

export const CANDIDATE_PROFILE_NAME_MAX = 100;
export const CANDIDATE_PROFILE_PHONE_MAX = 30;
export const CANDIDATE_PROFILE_LOCATION_MAX = 200;

/** Digits, spaces and + - ( ) . only, with at least 7 digits; empty clears the phone. */
export function isValidCandidatePhone(value: string): boolean {
  const phone = value.trim();
  if (phone === '') return true;
  return /^[0-9+()\-.\s]+$/.test(phone) && phone.replace(/\D/g, '').length >= 7;
}

export const candidatePortalProfileSchema = z
  .object({
    firstName: z.string().trim().min(1).max(CANDIDATE_PROFILE_NAME_MAX),
    lastName: z.string().trim().min(1).max(CANDIDATE_PROFILE_NAME_MAX),
    phone: z.string().trim().max(CANDIDATE_PROFILE_PHONE_MAX).refine(isValidCandidatePhone),
    location: z.string().trim().max(CANDIDATE_PROFILE_LOCATION_MAX),
  })
  .strict();

export type CandidatePortalProfileInput = z.infer<typeof candidatePortalProfileSchema>;
