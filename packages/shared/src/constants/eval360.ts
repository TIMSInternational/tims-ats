// 360 Evaluation (Sprint 1.7) — FRESH competency set (decision B: no DB Competency
// table). Rating scale for each competency is Int 1-5 (validated at the zod
// boundary in validators/evaluation360.ts, not here).
export const EVAL360_COMPETENCIES = [
  'leadership',
  'communication',
  'collaboration',
  'execution',
  'adaptability',
  'integrity',
] as const;
export type Eval360Competency = (typeof EVAL360_COMPETENCIES)[number];

// Rater relationship values — mirrors the Prisma `RaterRelationship` enum
// (packages/db/prisma/schema/evaluation360.prisma). Kept as a shared constant
// so the router's zod input schema and any other consumer stay in lockstep
// with the DB enum instead of hand-writing the tuple in multiple places.
export const RATER_RELATIONSHIPS = ['self', 'manager', 'peer', 'direct_report'] as const;
export type RaterRelationshipValue = (typeof RATER_RELATIONSHIPS)[number];
