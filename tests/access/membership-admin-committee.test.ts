import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { blockAt } from '../helpers/source-blocks';

const ROOT = join(__dirname, '..', '..');
const crud = () => readFileSync(join(ROOT, 'packages/api/src/routers/interview/crud.ts'), 'utf8');

describe('interview evaluator management', () => {
  it('addEvaluator gated by interview:update', () => {
    expect(crud()).toMatch(/addEvaluator:\s*permissionProcedure\('interview',\s*'update'\)/);
  });
  it('removeEvaluator gated by interview:update', () => {
    expect(crud()).toMatch(/removeEvaluator:\s*permissionProcedure\('interview',\s*'update'\)/);
  });
  it('addEvaluator org-verifies the evaluator user (IDOR)', () => {
    const body = blockAt(crud(), 'addEvaluator:');
    expect(body).toMatch(/user\.(findFirst|count)/);
  });
  it('addEvaluator maps duplicate to CONFLICT', () => {
    expect(crud()).toMatch(/P2002|code:\s*'CONFLICT'/);
  });

  // ── Escalation guards (codex slice-7a) ──────────────────────────────────
  // The InterviewEvaluator row is a committee-arm anchor that grants future
  // read access. A team-scoped caller must not grab an out-of-scope interview
  // by id and self-add → both endpoints must SCOPE-probe the interview parent
  // (assertScoped), not just org-check it.
  it('addEvaluator scope-probes the interview parent (no bare org-only findFirst)', () => {
    const body = blockAt(crud(), 'addEvaluator:');
    expect(body).toMatch(/assertScoped\('interview'/);
    // The escalation hole was the bare org-only parent check — it must be gone.
    expect(body).not.toMatch(/interview\.findFirst/);
  });
  it('removeEvaluator scope-probes the interview parent', () => {
    const body = blockAt(crud(), 'removeEvaluator:');
    expect(body).toMatch(/assertScoped\('interview'/);
    expect(body).not.toMatch(/interview\.findFirst/);
  });
});
