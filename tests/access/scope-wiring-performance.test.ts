import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { blockAt } from '../helpers/source-blocks';

// Wave 2.5 slice 4 — static tripwires for the performance module. Every
// row-level read composes the scope fragment via AND; by-id mutations probe via
// assertScoped; creates that TARGET another user gate via assertSubjectInScope;
// org-rollup dashboards gate via requireOrgScope. Fragment behavior itself is
// covered by tests/access/entity-policies.test.ts and write-rules.test.ts.
const ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, 'packages/api/src/routers/performance', p), 'utf8');

describe('performance module scope wiring', () => {
  it('okrs.ts: list/getById compose the okr fragment via AND, mutations probe, create gates the target', () => {
    const src = read('okrs.ts');
    expect(src).toMatch(/scopeWhereFor\('okr'/);
    expect(src).toMatch(/AND:\s*\[/);
    expect((src.match(/assertScoped\('okr'/g) ?? []).length).toBeGreaterThanOrEqual(1);
    expect(src).toMatch(/assertSubjectInScope/);
  });

  it('coaching.ts: list composes coachingSession, create gates the employee target, complete probes', () => {
    const src = read('coaching.ts');
    expect(src).toMatch(/scopeWhereFor\('coachingSession'/);
    expect(src).toMatch(/assertSubjectInScope/);
  });

  it('feedback.ts: lists compose the feedback fragment; create is deliberately unprobed (cross-team by design)', () => {
    const src = read('feedback.ts');
    expect(src).toMatch(/scopeWhereFor\('feedback'/);
    // Giving feedback/recognition to anyone in the org is intended product
    // behavior — the create paths stay UNPROBED, documented in the source.
    expect(src).toMatch(/cross-team by design/);
  });

  it('dashboard.ts: org-rollup KPIs gate via requireOrgScope', () => {
    expect(read('dashboard.ts')).toMatch(/requireOrgScope/);
  });

  it('no file spreads a scope fragment (AND-composition, CI check 13)', () => {
    for (const f of ['okrs.ts', 'coaching.ts', 'feedback.ts', 'dashboard.ts']) {
      expect(read(f)).not.toMatch(/\.\.\.(await\s+)?scopeWhere/);
    }
  });
});

describe('commitment child-path (codex)', () => {
  const src = () => readFileSync(join(ROOT, 'packages/api/src/routers/performance/coaching.ts'), 'utf8');
  it('listCommitments composes the commitment fragment', () => {
    const block = blockAt(src(), 'listCommitments:');
    expect(block).toMatch(/scopeWhereFor\('commitment'/);
  });
  it('createCommitment subject-checks the employee, probes the optional session, and binds session↔employee', () => {
    const block = blockAt(src(), 'createCommitment:');
    expect(block).toMatch(/assertSubjectInScope/);
    expect(block).toMatch(/assertScoped\('coachingSession'/);
    // codex round-2: the parent session must belong to the same employee
    expect(block).toMatch(/employeeId:\s*input\.employeeId/);
    expect(block).toMatch(/La sesion no corresponde a este empleado/);
  });
  it('updateCommitment probes the commitment (was a bare update-by-id)', () => {
    const block = blockAt(src(), 'updateCommitment:');
    expect(block).toMatch(/assertScoped\('commitment'/);
  });
});
