import { logger } from '@tims/shared';
import { fieldsVisibleTo, CLASSIFICATION } from './classification';

// Non-sensitive anchor fields ALWAYS selected so callers can join/scope rows even
// when no sensitive field is visible. Per-entity: every registered model has `id`;
// the user-anchored ones also carry organizationId + userId (used by row-scope
// composition). A field listed here is NEVER classified — it is structural.
const ANCHOR_FIELDS: Record<string, readonly string[]> = {
  employeeCompensation: ['id', 'organizationId', 'userId'],
  salaryAdjustment: ['id', 'organizationId', 'userId'],
  assessmentResult: ['id', 'organizationId', 'assignmentId'],
  employeeDemographics: ['id', 'organizationId', 'userId'],
  surveyResponse: ['id', 'organizationId', 'surveyId', 'userId'],
};

/**
 * Build a Prisma `select` object for an entity given the caller's roles.
 * FAIL-CLOSED: only fields the roles are entitled to (per classification.ts) are
 * set to `true`; everything else is omitted, so Prisma never returns it. Anchor
 * fields are always present. Unknown entity → `{ id: true }` (safe minimum).
 *
 * Use this INSTEAD of hand-rolled selects on sensitive models — never select a
 * sensitive field and null it afterward (the value still leaves the DB and may be
 * logged). Selecting-not-then-nulling is the rule (db.md / api-security.md).
 * NOTE: surveyResponse.userId is nullable (anonymous responses) — callers using
 * it as a row-scope anchor must null-check before relying on it.
 */
export function selectFor(roles: string[], entity: string): Record<string, true> {
  const anchors = ANCHOR_FIELDS[entity];
  const select: Record<string, true> = {};
  if (!CLASSIFICATION[entity] || !anchors) {
    // Registered in exactly one map = a config drift bug; both-missing = a
    // legitimately unknown entity (callers may probe). Warn only on drift.
    if (!!CLASSIFICATION[entity] !== !!anchors) {
      logger.warn({ entity }, 'selectFor: CLASSIFICATION/ANCHOR_FIELDS drift — entity registered in only one map; returning {id:true}');
    }
    select.id = true;
    return select;
  }
  for (const a of anchors) select[a] = true;
  for (const f of fieldsVisibleTo(roles, entity)) select[f] = true;
  return select;
}
