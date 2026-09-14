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
    // IMPORT lines are skipped, not counted, so occurrence 1 is the first real
    // declaration rather than `import { permissionProcedure } from '../../trpc'`.
    expect(blockAt(ROUTER, 'permissionProcedure', { occurrence: 1 })).toMatch(/'create'/);
    expect(blockAt(ROUTER, 'permissionProcedure', { occurrence: 2 })).toMatch(/'update'/);
  });
});

describe('blockAt — shapes other than tRPC procedures', () => {
  it('bounds an async class method at the next method', () => {
    // OBJECT LITERAL, not `class` — packages/api/src has only two `class`
    // declarations and neither is a tripwire target. Every "method" anchor in the
    // converted set is an object-literal method, e.g.
    // packages/api/src/repositories/candidate.repository.ts:167 `export const
    // candidateRepository = {`. An earlier fixture here used `export class`, a shape
    // the codebase never produces.
    const repo = `export const candidateRepository = {
  async getById(id: string) {
    return db.candidate.findUnique({ where: { id }, select: detailSelect });
  },

  async create(input: CreateInput) {
    await assertQuota(input.organizationId);
    return db.candidate.create({ data: input });
  },
};
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

  it('bounds an if-branch at its own `} else {` — not at the end of the else', () => {
    // The real site is if/ELSE (packages/api/src/services/candidate-assessment.service.ts:107),
    // not two sibling ifs. An earlier fixture modelled siblings and so proved a bound
    // the helper did not actually deliver: because every `}`-leading line counted as a
    // continuation, `} else {` was skipped and the extracted "free_text branch"
    // swallowed the whole else — 3.5x LOOSER than the `.slice(0, 400)` it replaced.
    // A review lens caught it. `} else {` now terminates: closers are a continuation
    // only when nothing follows them.
    const svc = `      for (const question of questions) {
        if (question.type === 'free_text') {
          await repo.upsertResponseInTx(tx, { isCorrect: null, pointsAwarded: null });
          pendingManual.push(question.id);
        } else {
          const { isCorrect, pointsAwarded } = scoreChoice(selected, question);
          graded.push({ isCorrect, pointsAwarded });
        }
      }
`;
    const freeText = blockAt(svc, "if (question.type === 'free_text') {");
    expect(freeText).toMatch(/pendingManual/);
    expect(freeText).not.toMatch(/scoreChoice/);
  });

  it('does NOT treat a spread sibling as a continuation', () => {
    // `...(cond ? {…} : {})` starts with `.`, and an earlier `isContinuationLine`
    // matched any leading `.` — so a block ran straight past spread siblings. 119 such
    // sites exist in packages/api/src, and it is the shape used for field-level
    // authorization (compensation.service.ts:66-76). Chained builder calls (`.input(`)
    // must still count as continuations, hence `.` but not `...`.
    const sel = `  const dto = {
    userId: true,
    ...(canSeeVariablePay ? { variablePay: true } : {}),
    ...(canSeeBand ? { bandId: true } : {}),
  };
`;
    expect(blockAt(sel, 'userId: true')).not.toMatch(/variablePay|bandId/);
  });

  it('returns to end-of-file only when the anchor is genuinely last', () => {
    // Asserts on text BELOW the anchor line. The earlier version matched
    // `db.thing.findMany` on the anchor's OWN line, so it held for any non-empty block
    // and survived deleting the bound entirely — it tested nothing about EOF.
    const tail = `export const r = router({
  first: protectedProcedure.query(() => db.a.findMany()),

  last: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(() => db.tail.findMany()),
});
`;
    expect(blockAt(tail, 'last:')).toMatch(/db\.tail\.findMany/);
    expect(blockAt(tail, 'first:')).not.toMatch(/db\.tail\.findMany/);
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
    // The regex literal must contain a LITERAL `//` pair, unescaped, or this test
    // survives deleting regex detection outright — which the earlier fixture did,
    // because its slashes were separated by backslashes. Caught by a review lens
    // mutating the feature the test names and watching it stay green.
    const src = ['const half = total / 2;', 'const proto = /[a-z]+:\\/\\//;', "const after = 'kept';", ''].join('\n');
    const out = stripComments(src);
    expect(out).toMatch(/const after = 'kept'/);
    expect(out).toMatch(/const half = total \/ 2;/);
  });

  it('terminates a string at a newline so a bare apostrophe cannot swallow later comments', () => {
    // JS string literals cannot span a raw newline, so ending them there is correct —
    // and without it, `don't` in JSX text opens a phantom string that stays open until
    // the next quote anywhere later, leaving every `//` comment in between un-blanked.
    // That resurrects prose-satisfies-a-gate, the class this helper exists to prevent.
    const src = ["return <p>don't</p>;", "// assertScoped('candidate') was removed", 'const x = 1;', ''].join('\n');
    expect(stripComments(src)).not.toMatch(/assertScoped/);
  });

  it('strips comments from the RETURNED block, not only during anchor resolution', () => {
    // Zero coverage before: mutating the return to slice the RAW source left every
    // helper test and all converted tests green, because only the anchor-resolution
    // half was asserted.
    const src = `export const r = router({
  target: protectedProcedure
    // assertScoped('candidate') is deliberately NOT called here
    .query(() => db.a.findMany()),

  next: protectedProcedure.query(() => db.b.findMany()),
});
`;
    expect(blockAt(src, 'target:')).not.toMatch(/assertScoped/);
  });

  it('minLines rejects a block too small for a negative assertion to mean anything', () => {
    const src = `export const r = router({
  tiny: protectedProcedure.query(() => db.a.findMany()),

  next: protectedProcedure.query(() => db.b.findMany()),
});
`;
    expect(() => blockAt(src, 'tiny:', { minLines: 5 })).toThrow(/minLines/);
    expect(blockAt(src, 'tiny:')).toMatch(/db\.a\.findMany/);
  });

  it('skips an import specifier so a moved declaration cannot resolve vacuously', () => {
    // The realistic refactor "extract candidateQuestionSelect to a shared module"
    // makes the first textual occurrence an import specifier. Anchoring there returns
    // `candidateQuestionSelect } from './selects';` and every `.not.toContain(...)`
    // over it passes vacuously, green, forever.
    const src = `import { candidateQuestionSelect } from './selects';

export const candidateQuestionSelectLocal = {
  id: true,
  correctOptionIds: true,
};
`;
    expect(() => blockAt(src, 'candidateQuestionSelect')).not.toThrow();
    expect(blockAt(src, 'candidateQuestionSelect')).toMatch(/correctOptionIds/);
  });
});
