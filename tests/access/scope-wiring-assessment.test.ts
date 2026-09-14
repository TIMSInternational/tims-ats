import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { blockAt } from '../helpers/source-blocks';

const ROOT = join(__dirname, '..', '..');
const src = () => readFileSync(join(ROOT, 'packages/api/src/routers/assessment.ts'), 'utf8');

describe('assessment module scope wiring', () => {
  it('lists compose scopeWhereFor(assessmentAssignment) in AND', () => {
    expect(src()).toMatch(/scopeWhereFor\('assessmentAssignment'/);
    expect(src()).toMatch(/AND:\s*\[/);
  });

  it('by-id endpoints are scope-probed (≥3 assertScoped on assignments)', () => {
    expect((src().match(/assertScoped\(\s*'assessmentAssignment'/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('assign/bulkAssign probe the parent vacancy', () => {
    expect(src()).toMatch(/assertScoped\('vacancy'/);
  });

  it('question bank stays org-level (deliberately unscoped)', () => {
    // Enumerated by procedure name rather than anchored on a COMMENT marker.
    // The old form sliced from '// Question authoring' to end-of-file: reword that
    // comment and indexOf returns -1, so slice(-1) yields the file's LAST CHARACTER
    // and this negative assertion passes over one character — a silent, total false
    // pass. Naming the four procedures also states the scope the title only implied.
    for (const proc of ['listQuestions:', 'createQuestion:', 'updateQuestion:', 'deleteQuestion:']) {
      expect(blockAt(src(), proc, { minLines: 3 }), proc).not.toMatch(/scopeWhereFor|assertScoped/);
    }
  });

  it('no scope-fragment spreads', () => {
    expect(src()).not.toMatch(/\.\.\.(await\s+)?scopeWhere/);
  });
});
