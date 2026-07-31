import { z } from 'zod';

// CB-2b — access-review inputs. The report/export/attestations-history READ inputs
// (accessReviewReportInput, exportAccessReviewCsvInput, listAccessReviewAttestationsInput)
// were deleted 2026-07-31 alongside their now-dead TS procedures — see access-review.ts's
// header comment. Only the attest WRITE input survives (separate flag, still dark).
export const attestAccessReviewInput = z.object({
  organizationId: z.string().uuid(),
  notes: z.string().max(2000).optional(),
});
