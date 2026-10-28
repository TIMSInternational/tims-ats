import { db, tenantDb } from '@tims/db';
import { canonicalizeEmail, escapeLikePattern, pickCanonicalEmailMatch } from '../lib/candidate-email';

// How long after its scheduled start an interview stays in the candidate's upcoming
// list (so an in-progress meeting remains joinable). Past this, it drops off and the
// join link is no longer exposed.
const INTERVIEW_JOIN_GRACE_MS = 2 * 60 * 60 * 1000; // 2 hours

// Data access for the authenticated candidate portal. Org-by-slug uses the
// privileged `db` (the org must be resolvable BEFORE a tenant context exists, and
// the careers site already exposes orgs by slug). Everything candidate-scoped goes
// through `tenantDb` (RLS) AND carries explicit `organizationId` + `candidateId`
// filters — defense in depth. The caller (service) wraps these in runWithTenant.

// Case-variant / superstring rows fetched by the fallback lookup before the exact
// post-filter. A miss beyond this bound fails CLOSED (no candidate), never to a
// different candidate.
const EMAIL_FALLBACK_TAKE = 50;

// #315: resolve the ACTIVE candidate of `organizationId` whose email canonically
// (trim + lowercase) equals the session email. Legacy rows written before email
// canonicalization may be mixed-case or whitespace-padded; an exact-equality lookup
// missed them, so those candidates saw an empty careers dashboard.
//   1. Fast path: exact match on the session email or its canonical form — served by
//      the (organization_id, email) unique index; covers every canonical row.
//   2. Fallback: escaped case-insensitive `contains` (catches mixed case AND stored
//      padding), then an exact canonical post-filter so `_`/`%` or a longer address
//      can never match.
// Must run inside runWithTenant (tenantDb RLS) like every other read here.
async function resolveActiveCandidateId(organizationId: string, email: string): Promise<string | null> {
  const canonical = canonicalizeEmail(email);
  if (canonical.length === 0) return null;
  const base = { organizationId, isActive: true, deletedAt: null };

  const exact = await tenantDb.candidate.findMany({
    where: { ...base, email: { in: [...new Set([email, canonical])] } },
    select: { id: true, email: true },
    orderBy: { createdAt: 'asc' },
    take: 2,
  });
  const exactHit = pickCanonicalEmailMatch(exact, email);
  if (exactHit) return exactHit.id;

  const variants = await tenantDb.candidate.findMany({
    where: { ...base, email: { contains: escapeLikePattern(canonical), mode: 'insensitive' } },
    select: { id: true, email: true },
    orderBy: { createdAt: 'asc' },
    take: EMAIL_FALLBACK_TAKE,
  });
  return pickCanonicalEmailMatch(variants, email)?.id ?? null;
}

export const candidatePortalRepo = {
  // Resolve an organization by its public careers slug. Returns minimal fields.
  findOrgBySlug(slug: string) {
    return db.organization.findUnique({
      where: { slug },
      select: { id: true, name: true, isActive: true },
    });
  },

  // Resolve the candidate for this session: org + email, active and not deleted.
  // Returns just the id — the session email is the trust anchor, not anything the
  // client sent.
  async findActiveCandidate(organizationId: string, email: string): Promise<{ id: string } | null> {
    const id = await resolveActiveCandidateId(organizationId, email);
    return id ? { id } : null;
  },

  // Candidate FAQ context anchor. Returns only the candidate's own display fields
  // plus id; never returns recruiter notes, tags, fit scores, assessments, or CV
  // content to the model.
  async findActiveCandidateProfile(organizationId: string, email: string) {
    const id = await resolveActiveCandidateId(organizationId, email);
    if (!id) return null;
    return tenantDb.candidate.findFirst({
      where: { id, organizationId, isActive: true, deletedAt: null },
      select: { id: true, firstName: true, lastName: true },
    });
  },

  // The candidate's display name for the portal /dashboard header. Same tenant-scoped path
  // as everything else here — the SSR gate must NOT read candidate data on the
  // privileged db (that would bypass RLS).
  async findCandidateName(organizationId: string, email: string) {
    const id = await resolveActiveCandidateId(organizationId, email);
    if (!id) return null;
    return tenantDb.candidate.findFirst({
      where: { id, organizationId, isActive: true, deletedAt: null },
      select: { firstName: true, lastName: true },
    });
  },

  // A candidate's applications, newest first. Scoped to BOTH candidate and org.
  findApplications(organizationId: string, candidateId: string) {
    return tenantDb.application.findMany({
      where: { candidateId, organizationId },
      select: {
        id: true,
        status: true,
        appliedAt: true,
        vacancy: { select: { id: true, title: true, company: { select: { name: true } } } },
        currentStage: { select: { id: true, name: true } },
      },
      orderBy: { appliedAt: 'desc' },
    });
  },

  // A candidate's UPCOMING interviews, soonest first. Scoped to BOTH candidate and
  // org. Includes meetingUrl for the join link — rendered safely on the client
  // (https-only guard).
  //
  // Status set matches the interview lifecycle that actually WRITES rows: create →
  // 'scheduled', reschedule → 'rescheduled' (a rescheduled interview is still live
  // and MUST stay visible — that's exactly when the candidate needs the new time +
  // link). 'confirmed' is kept defensively though no path writes it today;
  // 'cancelled'/'completed' are deliberately excluded.
  //
  // Time bound: only interviews whose start is within a grace window of now or in
  // the future. Without it, a past 'scheduled' row would keep rendering a stale Join
  // button (needless exposure of a meeting-room URL after the appointment). The
  // grace keeps an in-progress interview joinable.
  findInterviews(organizationId: string, candidateId: string) {
    const cutoff = new Date(Date.now() - INTERVIEW_JOIN_GRACE_MS);
    return tenantDb.interview.findMany({
      where: {
        candidateId,
        organizationId,
        status: { in: ['scheduled', 'confirmed', 'rescheduled'] },
        scheduledAt: { gte: cutoff },
      },
      select: {
        id: true,
        type: true,
        status: true,
        scheduledAt: true,
        duration: true,
        location: true,
        meetingUrl: true,
        vacancy: { select: { title: true } },
      },
      orderBy: { scheduledAt: 'asc' },
    });
  },

  // A candidate's offers that have actually been extended to them — status in the
  // candidate-facing set ('sent'/'accepted'/'declined'); internal pre-send states
  // (draft/pending_approval/approved) are never surfaced. Scoped to BOTH candidate
  // and org. `settings` is selected only so the service can extract the signing
  // token for the /offers/sign/[token] deep-link; it is NOT returned to the client.
  findOffers(organizationId: string, candidateId: string) {
    return tenantDb.offer.findMany({
      where: {
        candidateId,
        organizationId,
        status: { in: ['sent', 'accepted', 'declined'] },
      },
      select: {
        id: true,
        status: true,
        salary: true,
        currency: true,
        startDate: true,
        contractType: true,
        expiresAt: true,
        settings: true,
        vacancy: { select: { title: true, company: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  // A single application's stage timeline. CRITICAL: scoped by candidateId as well
  // as organizationId — org-only scoping would let a candidate read another
  // candidate's application by guessing its id (IDOR).
  findApplicationDetail(organizationId: string, candidateId: string, applicationId: string) {
    return tenantDb.application.findFirst({
      where: { id: applicationId, candidateId, organizationId },
      select: {
        id: true,
        status: true,
        appliedAt: true,
        vacancy: { select: { title: true } },
        currentStage: { select: { name: true } },
        movements: {
          select: { toStage: { select: { name: true } }, movedAt: true },
          orderBy: { movedAt: 'desc' },
        },
      },
    });
  },
};
