import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { blockAt } from '../helpers/source-blocks';

const ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, 'packages/api/src/routers/interview', p), 'utf8');

describe('interview module scope wiring', () => {
  it('crud.ts: list composes scopeWhereFor(interview) in AND; by-id endpoints probed', () => {
    const src = read('crud.ts');
    expect(src).toMatch(/scopeWhereFor\('interview'/);
    expect(src).toMatch(/AND:\s*\[/);
    expect((src.match(/assertScoped\('interview'/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('scorecards.ts: submitScorecard requires the submitter to be an ASSIGNED EVALUATOR', () => {
    const src = read('scorecards.ts');
    const block = blockAt(src, 'submitScorecard:');
    // slice-1 codex carry-over: org-probe alone let ANY org member upsert a scorecard
    expect(block).toMatch(/interviewEvaluator\.findFirst|evaluators:\s*\{\s*some/);
    expect(block).toMatch(/FORBIDDEN/);
  });

  it('media.ts + scorecards.ts reads are scoped', () => {
    for (const f of ['media.ts', 'scorecards.ts']) {
      expect(read(f)).toMatch(/assertScoped\('interview'|scopeWhereFor\('interview'/);
    }
  });

  it('schedule scope-probes the candidate AND binds applicationId to candidate+vacancy', () => {
    const src = read('crud.ts');
    const block = blockAt(src, 'schedule:');
    // codex re-review: org-only candidate check let a narrow-scoped scheduler
    // pull any org candidate into an interview + invitation email
    expect(block).toMatch(/assertScoped\('candidate'/);
    expect(block).toMatch(/candidateId:\s*input\.candidateId,\s*vacancyId:\s*input\.vacancyId/);
  });

  it('schedule binds candidate↔vacancy even when applicationId is omitted', () => {
    const src = read('crud.ts');
    const block = blockAt(src, 'schedule:');
    // codex round-3: omitted applicationId must auto-resolve the binding
    // application (persisted) and fail closed for narrow scopes when none exists
    expect(block).toMatch(/data\.applicationId\s*=\s*boundApp\.id/);
    expect(block).toMatch(/El candidato no tiene aplicacion a esta vacante/);
  });

  it('no scope-fragment spreads', () => {
    for (const f of ['crud.ts', 'scorecards.ts', 'media.ts', 'ai.ts']) {
      expect(read(f)).not.toMatch(/\.\.\.(await\s+)?scopeWhere/);
    }
  });
});
