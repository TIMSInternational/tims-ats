import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { submitRatingsInput } from '@tims/shared';

// Sprint 1.7 Slice 3 — evaluation360 self-service rating submission input (zod). The TS
// evaluation360 router that used to own this schema has been deleted (C# cutover complete);
// the schema itself moved to packages/shared/src/validators/evaluation360.ts since it encodes
// a real business rule (exactly 6 ratings, one per competency) worth keeping under test
// independent of which stack enforces it at the API boundary.

const ROOT = join(__dirname, '..', '..');

const SIX_RATINGS = [
  { competencyKey: 'leadership' as const, rating: 4 },
  { competencyKey: 'communication' as const, rating: 4 },
  { competencyKey: 'collaboration' as const, rating: 4 },
  { competencyKey: 'execution' as const, rating: 4 },
  { competencyKey: 'adaptability' as const, rating: 4 },
  { competencyKey: 'integrity' as const, rating: 4 },
];

describe('submitRatingsInput (zod)', () => {
  const ASSIGNMENT_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

  it('accepts exactly 6 ratings, one per competency, rating 1-5, optional bounded comment', () => {
    const result = submitRatingsInput.safeParse({
      assignmentId: ASSIGNMENT_ID,
      ratings: SIX_RATINGS.map((r) => ({ ...r, comment: 'ok' })),
    });
    expect(result.success).toBe(true);
  });

  it('rejects 5 ratings (missing one competency)', () => {
    const result = submitRatingsInput.safeParse({
      assignmentId: ASSIGNMENT_ID,
      ratings: SIX_RATINGS.slice(0, 5),
    });
    expect(result.success).toBe(false);
  });

  it('rejects 6 ratings with a duplicate competencyKey (even though length is 6)', () => {
    const dupRatings = [...SIX_RATINGS.slice(0, 5), { competencyKey: 'leadership' as const, rating: 3 }];
    const result = submitRatingsInput.safeParse({ assignmentId: ASSIGNMENT_ID, ratings: dupRatings });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown competencyKey', () => {
    const badRatings = [...SIX_RATINGS.slice(0, 5), { competencyKey: 'not_a_competency', rating: 3 }];
    const result = submitRatingsInput.safeParse({ assignmentId: ASSIGNMENT_ID, ratings: badRatings });
    expect(result.success).toBe(false);
  });

  it('rejects a rating outside 1-5', () => {
    const badRatings = [...SIX_RATINGS.slice(0, 5), { competencyKey: 'integrity' as const, rating: 6 }];
    const result = submitRatingsInput.safeParse({ assignmentId: ASSIGNMENT_ID, ratings: badRatings });
    expect(result.success).toBe(false);
  });

  it('rejects a comment over 5000 chars', () => {
    const badRatings = [
      ...SIX_RATINGS.slice(0, 5),
      { competencyKey: 'integrity' as const, rating: 3, comment: 'x'.repeat(5001) },
    ];
    const result = submitRatingsInput.safeParse({ assignmentId: ASSIGNMENT_ID, ratings: badRatings });
    expect(result.success).toBe(false);
  });

  it('rejects a non-uuid assignmentId', () => {
    const result = submitRatingsInput.safeParse({ assignmentId: 'not-a-uuid', ratings: SIX_RATINGS });
    expect(result.success).toBe(false);
  });
});

describe('evaluation360 access wiring — raterAssignment identity-anchoring', () => {
  // Fix wave (Important — RBAC over-restriction, opus): rater self-service is IDENTITY-anchored
  // (raterUserId/subjectUserId === ctx.user.id), not an RBAC grant. raterAssignment must stay
  // OUT of the scope system entirely — registering it as a ScopedEntity would let
  // assertScoped/scopeWhereFor resolve an org-scoped caller's (super_admin/hr_admin) where-clause
  // to `{}`, letting an admin submit/read on behalf of another rater (forged 360 feedback).
  it('raterAssignment is not registered as a ScopedEntity (no assertScoped delegate) — confirms identity-anchoring is the only guard, by design', () => {
    const entityPolicies = readFileSync(join(ROOT, 'packages/api/src/access/entity-policies.ts'), 'utf8');
    const scopedProbe = readFileSync(join(ROOT, 'packages/api/src/access/scoped-probe.ts'), 'utf8');
    expect(entityPolicies).not.toMatch(/raterAssignment/);
    expect(scopedProbe).not.toMatch(/raterAssignment/);
  });
});
