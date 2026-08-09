import { describe, it, expect } from 'vitest';
import { blockAt, stripComments } from './source-blocks';

// ── Mutation proof for the bounded-block extractor ────────────────────────────
//
// `blockAt` is the shared mechanism behind ~36 converted static tripwires, so the
// proof that the hollow-slice defect is actually gone lives HERE rather than being
// re-derived at each call site. The defect: `SRC.slice(SRC.indexOf('name'))` runs to
// end-of-file, so an assertion "procedure X carries guard G" is satisfied by G
// appearing in ANY later procedure.
//
// Every fixture below is formatted the way this repo's Prettier config actually
// formats routers — procedures at 2-space indent, chained builder methods at 4,
// verified against packages/api/src/routers/interview/crud.ts:114 and
// scorecards.ts:36. A fixture whose shape the codebase never produces would prove
// only that the pattern matches itself.

const ROUTER = `import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';

export const interviewRouter = router({
  schedule: permissionProcedure('interview', 'create')
    .input(
      z.object({
        candidateId: z.string().uuid(),
        scheduledAt: z.date(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const created = await db.interview.create({ data: input });
      return created;
    }),

  reschedule: permissionProcedure('interview', 'update')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertScoped('interview', input.id, ctx.access, ctx.user.id);
      return db.interview.update({ where: { id: input.id }, data: input });
    }),
});
`;

describe('blockAt — the bound is real (the hollow-slice defect)', () => {
  it("does NOT let a later procedure satisfy an earlier one's assertion", () => {
    // `assertScoped` lives in `reschedule`, NOT in `schedule`.
    expect(ROUTER).toMatch(/assertScoped/); // present in the file...
    expect(blockAt(ROUTER, 'schedule:')).not.toMatch(/assertScoped/); // ...but not in this block.

    // This is precisely what the unbounded idiom got wrong:
    const hollow = ROUTER.slice(ROUTER.indexOf('schedule:'));
    expect(hollow).toMatch(/assertScoped/);
  });

  it('still finds a guard that IS in the anchored procedure', () => {
    expect(blockAt(ROUTER, 'reschedule:')).toMatch(/assertScoped/);
  });

  it('stops at the next sibling declaration', () => {
    const block = blockAt(ROUTER, 'schedule:');
    expect(block).toMatch(/db\.interview\.create/);
    expect(block).not.toMatch(/reschedule/);
    expect(block).not.toMatch(/db\.interview\.update/);
  });

  it('the two-argument form degrades to unbounded when the end anchor is deleted', () => {
    // Why the sounder-looking `slice(indexOf(A), indexOf(B))` is still not safe:
    // indexOf returns -1 for a deleted B, and slice(n, -1) means "to one char before
    // the end" — silently the whole rest of the file again.
    const renamed = ROUTER.replace(/reschedule/g, 'moveInterview');
    const twoArg = renamed.slice(renamed.indexOf('schedule:'), renamed.indexOf('reschedule:'));
    expect(renamed.indexOf('reschedule:')).toBe(-1);
    expect(twoArg).toMatch(/assertScoped/); // leaked

    expect(blockAt(renamed, 'schedule:')).not.toMatch(/assertScoped/); // bounded anyway
  });
});

describe('blockAt — anchor resolution', () => {
  it('throws when the anchor is absent rather than asserting over the whole file', () => {
    expect(() => blockAt(ROUTER, 'noSuchProcedure:')).toThrow(/not found/);
  });

  it('does not resolve an anchor that exists only in a comment', () => {
    const src = `export const r = router({
  // deleteFeatureFlag: removed 2026-07-01, see #123
  listFeatureFlags: protectedProcedure.query(() => db.featureFlag.findMany()),
});
`;
    expect(src).toMatch(/deleteFeatureFlag/);
    expect(() => blockAt(src, 'deleteFeatureFlag:')).toThrow(/not found/);
  });

  it('selects a later occurrence when asked', () => {
    // Occurrence counting is over the whole file, so the IMPORT of a builder counts
    // as occurrence 1 — the two procedure declarations are 2 and 3. Anchoring on a
    // builder name rather than a declaration name is therefore fragile; prefer
    // `'schedule:'` over `{ occurrence: 2 }`. Kept here because that off-by-one is
    // exactly what a call site would get wrong.
    expect(blockAt(ROUTER, 'permissionProcedure', { occurrence: 1 })).toMatch(/from '\.\.\/\.\.\/trpc'/);
    expect(blockAt(ROUTER, 'permissionProcedure', { occurrence: 2 })).toMatch(/'create'/);
    expect(blockAt(ROUTER, 'permissionProcedure', { occurrence: 3 })).toMatch(/'update'/);
  });
});

describe('blockAt — shapes other than tRPC procedures', () => {
  it('bounds an async class method at the next method', () => {
    const repo = `export class CandidateRepository {
  async getById(id: string) {
    return db.candidate.findUnique({ where: { id }, select: detailSelect });
  }

  async create(input: CreateInput) {
    await assertQuota(input.organizationId);
    return db.candidate.create({ data: input });
  }
}
`;
    expect(blockAt(repo, 'async getById')).not.toMatch(/assertQuota/);
    expect(blockAt(repo, 'async create')).toMatch(/assertQuota/);
  });

  it('survives a Prettier-wrapped multi-line signature', () => {
    // Regression fixture. The first version of `blockAt` bounded purely on indentation
    // and cut this block off at `  ) {` — same indent as the declaration — so the block
    // was the SIGNATURE ONLY and every body assertion failed. Copied from the real shape
    // of packages/api/src/repositories/candidate.repository.ts:584, which is how Prettier
    // formats any signature past the print width. The earlier fixtures all used
    // single-line signatures and so proved nothing about this.
    const repo = `export class CandidateRepository {
  async getDashboardKpis(
    orgId: string,
    scopeWhere: Prisma.CandidateWhereInput,
    appScopeWhere: Prisma.ApplicationWhereInput,
  ) {
    return db.application.count({
      where: { AND: [{ status: 'active' }, appScopeWhere] },
    });
  }

  async unrelated(orgId: string) {
    return db.thing.count({ where: { orgId } });
  }
}
`;
    const block = blockAt(repo, 'async getDashboardKpis');
    expect(block).toMatch(/appScopeWhere/);
    expect(block).toMatch(/status:\s*'active'/);
    expect(block).not.toMatch(/db\.thing\.count/);
  });

  it('bounds a top-level const declaration at the next top-level declaration', () => {
    const mw = `const withSecurityAudit = t.middleware(async ({ ctx, next, path }) => {
  const result = await next();
  return result;
});

function requireExternalPermission(resource: string) {
  logSecurityEvent({ action: 'authz_denied', entity: resource });
}
`;
    expect(blockAt(mw, 'const withSecurityAudit')).not.toMatch(/logSecurityEvent/);
    expect(blockAt(mw, 'function requireExternalPermission')).toMatch(/logSecurityEvent/);
  });

  it('bounds an inner block at its own closing brace', () => {
    const svc = `  async submitAssessment(input: SubmitInput) {
    for (const question of questions) {
      if (question.type === 'free_text') {
        scored.push({ questionId: question.id, requiresManualReview: true });
      }
      if (question.type === 'single_choice') {
        scored.push({ questionId: question.id, isCorrect: matches(question) });
      }
    }
  }
`;
    const freeText = blockAt(svc, "if (question.type === 'free_text') {");
    expect(freeText).toMatch(/requiresManualReview/);
    expect(freeText).not.toMatch(/isCorrect/);
  });

  it('returns to end-of-file only when the anchor is genuinely last', () => {
    const tail = `export const r = router({
  onlyOne: protectedProcedure.query(() => db.thing.findMany()),
});
`;
    // Nothing later can satisfy the assertion, so an unbounded tail is correct here.
    expect(blockAt(tail, 'onlyOne:')).toMatch(/db\.thing\.findMany/);
  });
});

describe('stripComments', () => {
  it('preserves offsets so extracted blocks line up with the original', () => {
    const src = 'const a = 1; // trailing\nconst b = 2;\n';
    expect(stripComments(src)).toHaveLength(src.length);
    expect(stripComments(src).split('\n')).toHaveLength(src.split('\n').length);
  });

  it('blanks line and block comments but keeps string contents', () => {
    const src = `const url = 'https://example.com/path'; // not a comment above
/* block
   comment */
const p = permissionProcedure('interview', 'create');
`;
    const out = stripComments(src);
    expect(out).toMatch(/'https:\/\/example\.com\/path'/); // the // inside a string survived
    expect(out).toMatch(/permissionProcedure\('interview', 'create'\)/); // literals intact
    expect(out).not.toMatch(/not a comment above/);
    expect(out).not.toMatch(/block/);
  });

  it('does not treat a division operator or a regex as a comment', () => {
    const src = `const half = total / 2;\nconst re = /https:\\/\\/x/;\nconst after = 'kept';\n`;
    const out = stripComments(src);
    expect(out).toMatch(/const after = 'kept'/);
  });
});
