import { z } from 'zod';

// Inbound vendor submission (Sprint 1.6). The API key is the principal — NEVER
// accept it as input. Bounds mirror the staff updateValidation path.
export const ExternalValidationSubmitInput = z.object({
  validationId: z.string().uuid(),
  status: z.enum(['passed', 'failed']),
  result: z
    .record(z.unknown())
    .refine((r) => JSON.stringify(r).length <= 100_000, 'result payload too large'),
  notes: z.string().max(5000).optional(),
});
export type ExternalValidationSubmitInput = z.infer<typeof ExternalValidationSubmitInput>;

// Stable versioned response contract. Bump schemaVersion + add a v2 mapper for
// breaking changes; never silently reshape v1.
export interface ExternalValidationResultV1 {
  schemaVersion: 'v1';
  id: string;
  status: string;
  completedAt: Date;
}
export interface ExternalValidationRow {
  id: string;
  status: string;
  completedAt: Date;
}
export function toExternalValidationResultV1(row: ExternalValidationRow): ExternalValidationResultV1 {
  return { schemaVersion: 'v1', id: row.id, status: row.status, completedAt: row.completedAt };
}
