import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const src = () => readFileSync(join(ROOT, 'packages/api/src/routers/assessment.ts'), 'utf8');

describe('assessment module scope wiring', () => {
  it('lists compose scopeWhereFor(assessmentAssignment) in AND', () => {
    expect(src()).toMatch(/scopeWhereFor\('assessmentAssignment'/);
    expect(src()).toMatch(/AND:\s*\[/);
  });

  it('by-id endpoints are scope-probed (≥3 assertScoped on assignments)', () => {
    expect((src().match(/assertScoped\('assessmentAssignment'/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('assign/bulkAssign probe the parent vacancy', () => {
    expect(src()).toMatch(/assertScoped\('vacancy'/);
  });

  it('question bank stays org-level (deliberately unscoped)', () => {
    // Slice from the question-bank comment block (last section); using the
    // comment marker avoids matching the `listQuestionsSchema` import alias.
    const marker = '// Question authoring';
    const qb = src().slice(src().indexOf(marker));
    expect(qb).not.toMatch(/scopeWhereFor|assertScoped/);
  });

  it('no scope-fragment spreads', () => {
    expect(src()).not.toMatch(/\.\.\.(await\s+)?scopeWhere/);
  });
});
