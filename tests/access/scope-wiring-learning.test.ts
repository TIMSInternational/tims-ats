import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { engagementProcedureBlocks, ENGAGEMENT_GRANT_ONLY } from './engagement-procedures';

// Wave 2.5 slice 4 — static tripwires for learning + engagement modules.
// learning.ts: enrollments/certificates are user-anchored (people scope);
//   Course/LearningPath is an ORG-LEVEL catalog — deliberately not scoped.
// engagement.ts: aggregate reads get requireOrgScope (interim until slice-6
//   min-5 scope-aware aggregation); listSurveys is the documented grant-only
//   exception. createSurvey/submitSurveyResponse were DELETED 2026-07-29 and
//   createActionPlan/updateActionPlan 2026-08-05 (#56) — C# is the sole writer
//   of action_plans now, so the router holds NO row-level write scoping at all;
//   that guarantee moved to services/Tims.Platform (see
//   tests/access/scope-wiring-engagement-write.test.ts's header).
// Fragment behavior covered by tests/access/entity-policies.test.ts;
// write-rules by tests/access/write-rules.test.ts.

const ROOT = join(__dirname, '..', '..');
const readRouter = (p: string) => readFileSync(join(ROOT, 'packages/api/src/routers', p), 'utf8');

describe('learning module scope wiring', () => {
  it('learning.ts composes enrollment fragment via scopeWhereFor', () => {
    const src = readRouter('learning.ts');
    expect(src).toMatch(/scopeWhereFor\('enrollment'/);
  });

  it('learning.ts gates assertSubjectInScope on enrollment targets', () => {
    const src = readRouter('learning.ts');
    expect(src).toMatch(/assertSubjectInScope/);
  });

  it('learning.ts gates org-rollup KPIs via requireOrgScope', () => {
    const src = readRouter('learning.ts');
    expect(src).toMatch(/requireOrgScope/);
  });

  it('learning.ts contains the org-level catalog design comment', () => {
    const src = readRouter('learning.ts');
    expect(src).toMatch(/ORG-LEVEL catalog/);
  });

  it('no spread of scope fragment in learning.ts (AND-composition, CI check 13)', () => {
    expect(readRouter('learning.ts')).not.toMatch(/\.\.\.(await\s+)?scopeWhere/);
  });
});

describe('engagement module scope wiring', () => {
  it('engagement.ts gates every aggregate read via requireOrgScope (per-procedure, not a count)', () => {
    // RE-ANCHORED 2026-08-05 (#56) — see tests/access/engagement-procedures.ts for why the old
    // `>= 5` count assertion was replaced. It had already been re-pinned twice (9 → 5) to whichever
    // procedures happened to survive the last deletion pass; #56 deleted getWordCloud/getSentiment
    // and would have forced a third re-pin to 3. The invariant, not the era, is asserted now.
    const blocks = engagementProcedureBlocks();
    expect(Object.keys(blocks).length).toBeGreaterThan(0); // never vacuous
    for (const [name, body] of Object.entries(blocks)) {
      if (ENGAGEMENT_GRANT_ONLY.has(name)) continue;
      expect(body, `${name} must call requireOrgScope`).toMatch(/requireOrgScope\(/);
    }
    for (const name of ENGAGEMENT_GRANT_ONLY) {
      expect(Object.keys(blocks), `${name} is allow-listed but no longer exists`).toContain(name);
    }
  });

  it('no spread of scope fragment in engagement.ts (AND-composition, CI check 13)', () => {
    expect(readRouter('engagement.ts')).not.toMatch(/\.\.\.(await\s+)?scopeWhere/);
  });
});

// 'engagement leaderCommitment scoping (review follow-up)' (listLeaderCommitments) REMOVED
// 2026-07-31 — its TS procedure was deleted (NEXT_PUBLIC_ENGAGEMENT_READ_VIA_CSHARP confirmed live
// in prod; C# is the sole implementation now). The equivalent scopeWhereFor('leaderCommitment')
// row-filter guarantee is now asserted against the live C# API by
// services/Tims.Platform/tests/Tims.IntegrationTests/Engagement/EngagementReadEndpointTests.cs.

describe('course detail enrollment scoping (codex)', () => {
  it('getCourseById scopes the embedded enrollments', () => {
    const src = readFileSync(join(ROOT, 'packages/api/src/routers/learning.ts'), 'utf8');
    const block = src.slice(src.indexOf('getCourseById'), src.indexOf('createCourse'));
    expect(block).toMatch(/enrollments:\s*\{\s*where:\s*enrollScope/);
  });
});
