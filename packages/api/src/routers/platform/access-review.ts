import { router } from '../../trpc';
import { platformProcedure } from './_common';
import { accessReviewService } from '../../services/access-review.service';
import { logSecurityEvent } from '../../access/security-audit';
import { attestAccessReviewInput } from './access-review.schemas';

// CB-2b — access review + per-org recertification (SOC 2 CC6.2–6.3 / ISO A.5.18).
// Platform-owner-only; writes via the privileged db across orgs.
//
// READ SIDE DELETED (2026-07-31): getAccessReview, exportAccessReviewCsv, and
// listAccessReviewAttestations were removed — NEXT_PUBLIC_ACCESS_REVIEW_READ_VIA_CSHARP is
// confirmed live in prod, so the C# read surface (`AccessReviewDbContext`) is the sole
// implementation now; apps/web/lib/platform-api/access-review.ts's useAccessReview /
// useAccessReviewExport / useAccessReviewAttestations hooks call it unconditionally.
// attestAccessReview (the write) stays here untouched — it is gated by a SEPARATE flag
// (NEXT_PUBLIC_ACCESS_REVIEW_WRITE_VIA_CSHARP, also confirmed live in prod 2026-07-31) and its
// TS-deletion is tracked as its own follow-up task, out of scope here.
export const accessReviewRouter = router({
  // Record a per-org recertification (the retained CC6.2–6.3 evidence) + a security event.
  attestAccessReview: platformProcedure.input(attestAccessReviewInput).mutation(async ({ ctx, input }) => {
    const { attestation, summary } = await accessReviewService.attest(
      input.organizationId,
      ctx.user.id,
      input.notes ?? null,
      new Date(),
    );
    void logSecurityEvent({
      organizationId: input.organizationId,
      actorId: ctx.user.impersonatorId ?? ctx.user.id,
      action: 'access_recertified',
      entity: 'access_review',
      entityId: attestation.id,
      metadata: { ...summary },
    });
    return attestation;
  }),
});
