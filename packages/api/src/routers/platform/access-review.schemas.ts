import { z } from 'zod';

// CB-2b — access-review inputs. Both the report READ and the CSV export REQUIRE an
// org: a whole-platform read/export of cross-org access data would be an unauditable
// bulk egress for an org-less platform owner (audit_logs.organizationId is NOT-NULL),
// and the per-org unit matches the attestation + is always bounded + auditable.
export const accessReviewReportInput = z.object({
  organizationId: z.string().uuid(),
});

export const exportAccessReviewCsvInput = accessReviewReportInput;

export const attestAccessReviewInput = z.object({
  organizationId: z.string().uuid(),
  notes: z.string().max(2000).optional(),
});

export const listAccessReviewAttestationsInput = z.object({
  organizationId: z.string().uuid(),
  limit: z.number().int().min(1).max(100).default(20),
});
