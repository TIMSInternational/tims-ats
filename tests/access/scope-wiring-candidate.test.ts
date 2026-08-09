import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { blockAt } from '../helpers/source-blocks';

const ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('candidate module scope wiring', () => {
  it('routers compute the fragment and pass scopeWhere into the service', () => {
    const src = read('packages/api/src/routers/candidate/crud.ts');
    expect(src).toMatch(/scopeWhereFor\('candidate'/);
  });

  it('candidate.service list/getById accept and forward scopeWhere', () => {
    const src = read('packages/api/src/services/candidate.service.ts');
    expect(src).toMatch(/scopeWhere/);
  });

  it('candidate.repository composes scopeWhere via AND (never spread)', () => {
    const src = read('packages/api/src/repositories/candidate.repository.ts');
    expect(src).toMatch(/AND:\s*\[/);
    expect(src).not.toMatch(/\.\.\.(await\s+)?scopeWhere/);
  });

  it('by-id mutations across pool/documents/tags/timeline are scope-probed', () => {
    for (const f of ['pool.ts', 'documents.ts', 'tags.ts', 'timeline.ts']) {
      expect(read(`packages/api/src/routers/candidate/${f}`)).toMatch(/assertScoped\('candidate'/);
    }
  });

  it('deleteDocument and parseCV probe the parent candidate via the document (fetch-then-probe)', () => {
    const src = read('packages/api/src/routers/candidate/documents.ts');
    // both documentId entry points must resolve the org-scoped document and
    // assertScoped its candidateId (same hop pattern as vacancy channels.unpublish)
    const deleteBlock = blockAt(src, 'deleteDocument:');
    const parseBlock = blockAt(src, 'parseCV:');
    expect(deleteBlock).toMatch(/assertScoped\('candidate'/);
    expect(parseBlock).toMatch(/assertScoped\('candidate'/);
  });

  it('bulkTag dedupes candidateIds before the scoped count-check', () => {
    const src = read('packages/api/src/services/candidate-tags.service.ts');
    const block = blockAt(src, 'async bulkTag');
    expect(block).toMatch(/new Set\(/);
  });

  // Codex F1 — candidate detail child relations must be scope-filtered so a
  // narrow-scoped user who sees the candidate via ONE in-scope application does
  // not also read their out-of-scope applications / fitScores / assessments.
  it('crud.getById computes the application fragment and threads it into the service', () => {
    const src = read('packages/api/src/routers/candidate/crud.ts');
    expect(src).toMatch(/scopeWhereFor\('application'/);
  });

  it('candidate.repository.getById scopes applications/fitScores/assessmentAssignments by the appScopeWhere param', () => {
    const src = read('packages/api/src/repositories/candidate.repository.ts');
    // The scoped child relations live in the module-level builder consumed by
    // getById; the behavior test below verifies the wiring end-to-end.
    const builder = blockAt(src, 'const buildCandidateDetailSelect');
    expect((builder.match(/where:\s*appScopeWhere/g) ?? []).length).toBeGreaterThanOrEqual(3);
    const getByIdBlock = blockAt(src, 'async getById');
    expect(getByIdBlock).toMatch(/buildCandidateDetailSelect\(appScopeWhere\)/);
  });

  // Codex F1 — timeline child loads must be scope-filtered too.
  it('candidate.repository.getTimelineData scopes its application/assessment child loads by the fragment', () => {
    const src = read('packages/api/src/repositories/candidate.repository.ts');
    const block = blockAt(src, 'async getTimelineData');
    expect(block).toMatch(/appScopeWhere/);
  });

  it('timeline.getTimeline computes the application fragment and threads it into the service', () => {
    const src = read('packages/api/src/routers/candidate/timeline.ts');
    expect(src).toMatch(/scopeWhereFor\('application'/);
  });

  // Codex F2 — ai.screen must probe BOTH the candidate and the vacancy before
  // writing a FitScore / calling the AI.
  it('ai.screen scope-probes both candidate and vacancy', () => {
    const src = read('packages/api/src/routers/candidate/ai.ts');
    expect(src).toMatch(/assertScoped\('candidate'/);
    expect(src).toMatch(/assertScoped\('vacancy'/);
  });

  // Codex re-review — list children + fit filter and getRisks children must
  // carry the application fragment too.
  it('repository.list threads appScopeWhere (children + fit filter scoped)', () => {
    const src = read('packages/api/src/repositories/candidate.repository.ts');
    const builder = blockAt(src, 'const buildCandidateListSelect');
    expect(builder).toMatch(/where:\s*appScopeWhere/);
    expect(builder).toMatch(/_count:\s*\{\s*select:\s*\{\s*applications:\s*\{\s*where:\s*appScopeWhere/);
    const listBlock = blockAt(src, 'async list');
    expect(listBlock).toMatch(/appScopeWhere/);
  });

  it('repository.getCandidateForRisks scopes applications and fitScores', () => {
    const src = read('packages/api/src/repositories/candidate.repository.ts');
    const block = blockAt(src, 'async getCandidateForRisks');
    expect((block.match(/where:\s*appScopeWhere/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  // Codex F4 — dashboard KPI active-application count must carry the application
  // scope fragment, like the sibling candidate counts.
  it('crud.getDashboardKpis computes the application fragment and threads it', () => {
    const src = read('packages/api/src/routers/candidate/crud.ts');
    const block = blockAt(src, 'getDashboardKpis:');
    expect(block).toMatch(/scopeWhereFor\('application'/);
  });

  it('candidate.repository.getDashboardKpis composes the appScopeWhere into the active-application count', () => {
    const src = read('packages/api/src/repositories/candidate.repository.ts');
    const block = blockAt(src, 'async getDashboardKpis');
    expect(block).toMatch(/appScopeWhere/);
    // the active-application count must AND the org filter with the app fragment
    expect(block).toMatch(/status:\s*'active'[\s\S]*appScopeWhere|appScopeWhere[\s\S]*status:\s*'active'/);
  });
});

describe('candidate detail child relations — behavior', () => {
  it('getById passes the application fragment as the where on each child relation', async () => {
    const captured: { args?: Record<string, unknown> } = {};
    vi.resetModules();
    vi.doMock('@tims/db', () => ({
      tenantDb: {
        candidate: {
          findFirst: vi.fn(async (args: Record<string, unknown>) => {
            captured.args = args;
            return null;
          }),
        },
      },
    }));
    const { candidateRepository } = await import('../../packages/api/src/repositories/candidate.repository');
    const appFrag = { vacancy: { AND: [{ businessUnitId: { in: ['bu1'] } }, { deletedAt: null }] } };
    await candidateRepository.getById('org-1', {}, 'cand-1', appFrag as never);

    const select = (captured.args?.select ?? {}) as Record<string, { where?: unknown }>;
    expect(select.applications?.where).toEqual(appFrag);
    expect(select.fitScores?.where).toEqual(appFrag);
    expect(select.assessmentAssignments?.where).toEqual(appFrag);
    vi.doUnmock('@tims/db');
  });
});
