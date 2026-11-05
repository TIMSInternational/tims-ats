import { db, tenantDb } from '@tims/db';

// How long after its scheduled start an interview stays in the candidate's upcoming
// list (so an in-progress meeting remains joinable). Past this, it drops off and the
// join link is no longer exposed.
const INTERVIEW_JOIN_GRACE_MS = 2 * 60 * 60 * 1000; // 2 hours

// Data access for the authenticated candidate portal. Org-by-slug uses the
// privileged `db` (the org must be resolvable BEFORE a tenant context exists, and
// the careers site already exposes orgs by slug). Everything candidate-scoped goes
// through `tenantDb` (RLS) AND carries explicit `organizationId` + `candidateId`
// filters — defense in depth. The caller (service) wraps these in runWithTenant.

// Offer statuses after which an offer is over for the candidate. Every OTHER status counts as in
// progress (fail-closed for a status added later): being prepared, in approval, approved, accepted —
// and 'sent' until its expiry.
const OFFER_CLOSED_STATUSES = ['declined', 'rejected', 'converted', 'cancelled', 'expired', 'withdrawn'];

function offerInProgress(now: Date) {
  return {
    OR: [
      { status: { notIn: ['sent', ...OFFER_CLOSED_STATUSES] } },
      { status: 'sent', OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    ],
  };
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
  findActiveCandidate(organizationId: string, email: string) {
    return tenantDb.candidate.findFirst({
      where: { organizationId, email, isActive: true, deletedAt: null },
      select: { id: true },
    });
  },

  // Candidate FAQ context anchor. Returns only the candidate's own display fields
  // plus id; never returns recruiter notes, tags, fit scores, assessments, or CV
  // content to the model.
  findActiveCandidateProfile(organizationId: string, email: string) {
    return tenantDb.candidate.findFirst({
      where: { organizationId, email, isActive: true, deletedAt: null },
      select: { id: true, firstName: true, lastName: true },
    });
  },

  // The candidate's display name and the contact fields they may correct ("Mis datos") for the
  // portal /dashboard. Same tenant-scoped path as everything else here — the SSR gate must NOT
  // read candidate data on the privileged db (that would bypass RLS).
  findCandidateName(organizationId: string, email: string) {
    return tenantDb.candidate.findFirst({
      where: { organizationId, email, isActive: true, deletedAt: null },
      select: { firstName: true, lastName: true, phone: true, location: true },
    });
  },

  // The candidate's own correction of their name/phone/location. Conditional on the same
  // org + id + active + not-deleted filters as every read, so a record that was deactivated or
  // deleted meanwhile is never revived or edited. Returns null when nothing matched.
  async updateCandidateProfile(
    organizationId: string,
    candidateId: string,
    data: { firstName: string; lastName: string; phone: string | null; location: string | null },
  ) {
    const result = await tenantDb.candidate.updateMany({
      where: { id: candidateId, organizationId, isActive: true, deletedAt: null },
      data,
    });
    if (result.count !== 1) return null;
    return tenantDb.candidate.findFirst({
      where: { id: candidateId, organizationId },
      select: { firstName: true, lastName: true, phone: true, location: true },
    });
  },

  // The candidate withdraws ONE of their own applications. A single conditional statement: only
  // an application of THIS candidate at THIS org that is still 'active' moves to 'withdrawn', so it
  // can never overwrite a hire or a rejection that committed first (hire-closure and
  // rejectApplication are conditional on 'active' the same way). It is also refused while an offer
  // to this candidate for that vacancy (linked or not) is in progress — anything but closed: being
  // prepared, in approval, approved, sent and not yet expired, or accepted. The offer
  // send/accept/hire guards only refuse REJECTED applications, so an offer that already exists must
  // not go on to be sent, accepted or converted for a withdrawn application; at that stage the
  // candidate answers the offer or asks the organization. A sent offer past its expiry cannot be
  // answered any more (signing refuses it), so it does not block.
  // NOT covered here: an offer INSERTED concurrently with this statement (offer.create neither locks
  // the application nor re-checks it at insert time). Closing that needs the offer create/send/accept
  // and hire-closure guards to refuse 'withdrawn' like 'rejected' — offer-side code, tracked as a
  // follow-up. Returns the number of rows moved (0 or 1).
  async withdrawApplication(organizationId: string, candidateId: string, applicationId: string, now = new Date()) {
    const result = await tenantDb.application.updateMany({
      where: {
        id: applicationId,
        candidateId,
        organizationId,
        status: 'active',
        vacancy: { offers: { none: { candidateId, ...offerInProgress(now) } } },
      },
      data: { status: 'withdrawn' },
    });
    return result.count;
  },

  // Why a withdrawal matched nothing: the application's current status, or null when this
  // candidate has no such application at this org.
  findOwnApplicationStatus(organizationId: string, candidateId: string, applicationId: string) {
    return tenantDb.application.findFirst({
      where: { id: applicationId, candidateId, organizationId },
      select: { status: true },
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
