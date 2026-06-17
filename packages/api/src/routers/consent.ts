import { router, protectedProcedure } from '../trpc';
import { tenantDb as db } from '@tims/db';

export const consentRouter = router({
  // ── My Consents (Slice 5B) ─────────────────────────────────────────
  // OWN-scoped self-service read of the caller's DataConsent rows. Reading your
  // OWN consent is inherently safe (no per-person disclosure of anyone else), so
  // a plain protectedProcedure is correct — no new permission MODULE is created.
  //
  // No input → subjectUserId is HARD-PINNED to ctx.user.id (a client-supplied
  // userId would let one employee read another's consent ledger — never accept
  // it). organizationId filter (defense-in-depth on top of RLS). Explicit select
  // of the display fields only (id/consentType/textVersion/agreedAt/withdrawnAt);
  // the raw subjectUserId/createdAt columns are not echoed back. READ-ONLY for
  // this slice — grant/withdraw mutations are a follow-up.
  myConsents: protectedProcedure.query(async ({ ctx }) => {
    return db.dataConsent.findMany({
      where: {
        organizationId: ctx.user.organizationId,
        subjectUserId: ctx.user.id,
      },
      select: {
        id: true,
        consentType: true,
        textVersion: true,
        agreedAt: true,
        withdrawnAt: true,
      },
      orderBy: { consentType: 'asc' },
    });
  }),
});
