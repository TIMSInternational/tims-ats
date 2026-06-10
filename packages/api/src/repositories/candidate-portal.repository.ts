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

  // The candidate's display name for the portal /me header. Same tenant-scoped path
  // as everything else here — the SSR gate must NOT read candidate data on the
  // privileged db (that would bypass RLS).
  findCandidateName(organizationId: string, email: string) {
    return tenantDb.candidate.findFirst({
      where: { organizationId, email, isActive: true, deletedAt: null },
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
