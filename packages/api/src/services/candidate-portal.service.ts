import { TRPCError } from '@trpc/server';
import { runWithTenant } from '@tims/db';
import { candidatePortalRepo } from '../repositories/candidate-portal.repository';

// Business logic for the authenticated candidate portal. The trust anchor is the
// Supabase session email (passed by the router from ctx.supabaseAuth) — never a
// client-supplied identifier. Every candidate read runs inside runWithTenant so the
// tenantDb RLS GUC is set for the resolved org.

// Lift the signing token out of an offer's `settings` JSON (set by staff when they
// generate the signing link). Returns null when absent — the offer just isn't
// signable yet. Narrowed defensively; never trusts the JSON shape.
function extractSigningToken(settings: unknown): string | null {
  if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
    const token = (settings as Record<string, unknown>).signingToken;
    if (typeof token === 'string' && token.length > 0) return token;
  }
  return null;
}

// Resolve and validate the org from its careers slug. Throws NOT_FOUND for missing
// or deactivated orgs (don't leak existence of inactive tenants).
async function resolveOrg(orgSlug: string) {
  const org = await candidatePortalRepo.findOrgBySlug(orgSlug);
  if (!org || !org.isActive) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Organizacion no encontrada' });
  }
  return org;
}

export const candidatePortalService = {
  // The signed-in candidate's display name at one org, or null if no candidate
  // matches. Used by the /me SSR gate so that candidate read also runs under tenant
  // RLS (runWithTenant), never on the privileged db. The org is already resolved by
  // the caller (it owns the notFound() decision for a bad slug).
  getDisplayCandidate(orgId: string, email: string) {
    return runWithTenant(orgId, () => candidatePortalRepo.findCandidateName(orgId, email));
  },

  // A candidate's applications at one org. An authenticated email with no Candidate
  // record at this org is a valid state (they just have nothing) → empty list, not
  // an error.
  async getMyApplications(email: string, orgSlug: string) {
    const org = await resolveOrg(orgSlug);
    return runWithTenant(org.id, async () => {
      const candidate = await candidatePortalRepo.findActiveCandidate(org.id, email);
      if (!candidate) return [];
      return candidatePortalRepo.findApplications(org.id, candidate.id);
    });
  },

  // The candidate's upcoming interviews at one org. Like applications, an
  // authenticated email with no Candidate record here is a valid empty state.
  async getMyInterviews(email: string, orgSlug: string) {
    const org = await resolveOrg(orgSlug);
    return runWithTenant(org.id, async () => {
      const candidate = await candidatePortalRepo.findActiveCandidate(org.id, email);
      if (!candidate) return [];
      return candidatePortalRepo.findInterviews(org.id, candidate.id);
    });
  },

  // The candidate's offers at one org. Maps each row to a safe DTO: the signing
  // token is lifted out of Offer.settings (for the /offers/sign/[token] deep-link)
  // and the raw settings JSON is dropped from the response. Empty list if no
  // candidate matches this session.
  async getMyOffers(email: string, orgSlug: string) {
    const org = await resolveOrg(orgSlug);
    return runWithTenant(org.id, async () => {
      const candidate = await candidatePortalRepo.findActiveCandidate(org.id, email);
      if (!candidate) return [];
      const offers = await candidatePortalRepo.findOffers(org.id, candidate.id);
      const now = Date.now();
      return offers.map(({ settings, ...offer }) => {
        // Only surface the public-by-token signing link for an offer that is still
        // SIGNABLE (status 'sent', not past its expiry). For accepted/declined/
        // expired offers the token is withheld (null) — no point handing the
        // browser a reusable bearer URL for a historical offer (codex review).
        const signable =
          offer.status === 'sent' && (!offer.expiresAt || offer.expiresAt.getTime() > now);
        return {
          ...offer,
          signingToken: signable ? extractSigningToken(settings) : null,
        };
      });
    });
  },

  // One application's stage timeline. Requires both a candidate for this session and
  // that the application belongs to them — otherwise NOT_FOUND (never reveal that an
  // id exists under another candidate).
  async getApplicationStatus(email: string, orgSlug: string, applicationId: string) {
    const org = await resolveOrg(orgSlug);
    return runWithTenant(org.id, async () => {
      const candidate = await candidatePortalRepo.findActiveCandidate(org.id, email);
      if (!candidate) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Postulacion no encontrada' });
      }
      const application = await candidatePortalRepo.findApplicationDetail(
        org.id,
        candidate.id,
        applicationId,
      );
      if (!application) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Postulacion no encontrada' });
      }
      return application;
    });
  },
};
