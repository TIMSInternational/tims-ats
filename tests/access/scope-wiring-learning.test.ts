import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

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
  it('engagement.ts gates aggregate reads via requireOrgScope (≥9 calls)', () => {
    const src = readRouter('engagement.ts');
    const matches = src.match(/requireOrgScope/g) ?? [];
    // 9 aggregate reads: getSurveyResults, getEnps, getClimateHeatmap,
    // getResultsByArea, getWordCloud, getSentiment, getLowClimateAlerts,
    // getRotationRisk, getDashboardKpis — all must be gated.
    expect(matches.length).toBeGreaterThanOrEqual(9);
  });

  it('no spread of scope fragment in engagement.ts (AND-composition, CI check 13)', () => {
    expect(readRouter('engagement.ts')).not.toMatch(/\.\.\.(await\s+)?scopeWhere/);
  });
});

describe('engagement leaderCommitment scoping (review follow-up)', () => {
  it('listLeaderCommitments composes the leaderCommitment fragment via AND', () => {
    const src = readFileSync(join(ROOT, 'packages/api/src/routers/engagement.ts'), 'utf8');
    const block = src.slice(src.indexOf('listLeaderCommitments'));
    expect(block).toMatch(/scopeWhereFor\('leaderCommitment'/);
    expect(block).toMatch(/AND:\s*\[/);
  });
});

describe('course detail enrollment scoping (codex)', () => {
  it('getCourseById scopes the embedded enrollments', () => {
    const src = readFileSync(join(ROOT, 'packages/api/src/routers/learning.ts'), 'utf8');
    const block = src.slice(src.indexOf('getCourseById'), src.indexOf('createCourse'));
    expect(block).toMatch(/enrollments:\s*\{\s*where:\s*enrollScope/);
  });
});
