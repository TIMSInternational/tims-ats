import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { blockAt } from '../helpers/source-blocks';

// Wave 2.5 slice 4 — static tripwires for learning + engagement modules.
// learning.ts: enrollments/certificates are user-anchored (people scope);
//   Course/LearningPath is an ORG-LEVEL catalog — deliberately not scoped.
// engagement.ts: aggregate reads get requireOrgScope (interim until slice-6
//   min-5 scope-aware aggregation); action plans are row-level (responsibleId
//   people anchor added to registry + scoped via assertSubjectInScope /
//   assertScoped); listSurveys UNTOUCHED — createSurvey/submitSurveyResponse were later DELETED
//   (2026-07-29; C# is the sole implementation, live in prod).
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
  it('engagement.ts gates the surviving aggregate reads via requireOrgScope (≥5 calls)', () => {
    const src = readRouter('engagement.ts');
    const matches = src.match(/requireOrgScope/g) ?? [];
    // UPDATE 2026-07-31 (NEXT_PUBLIC_ENGAGEMENT_READ_VIA_CSHARP confirmed live in prod): getEnps,
    // getClimateHeatmap, getLowClimateAlerts, getDashboardKpis were deleted (C#-only now), each of
    // which also called requireOrgScope — the floor dropped from 9 to 5. Survivors: getSurveyResults,
    // getResultsByArea, getWordCloud, getSentiment, getRotationRisk — all must still be gated.
    expect(matches.length).toBeGreaterThanOrEqual(5);
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
    const block = blockAt(src, 'getCourseById:');
    expect(block).toMatch(/enrollments:\s*\{\s*where:\s*enrollScope/);
  });
});
