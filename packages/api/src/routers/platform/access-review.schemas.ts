import { z } from 'zod';

// CB-2b — access-review inputs. Both the report READ and the CSV export REQUIRE an
// org: a whole-platform read/export of cross-org access data would be an unauditable
// bulk egress for an org-less platform owner (audit_logs.organizationId is NOT-NULL),
// and the per-org unit matches the attestation + is always bounded + auditable.
export const accessReviewReportInput = z.object({
  organizationId: z.string().uuid(),
});

export const exportAccessReviewCsvInput = accessReviewReportInput;

// NOTE: `attestAccessReviewInput` (the write's input schema) was DELETED 2026-07-31 alongside
// the `attestAccessReview` procedure — its C# port is confirmed live and is the sole active
// writer of `access_reviews`. See `packages/api/src/routers/platform/access-review.ts`.

export const listAccessReviewAttestationsInput = z.object({
  organizationId: z.string().uuid(),
  limit: z.number().int().min(1).max(100).default(20),
});
