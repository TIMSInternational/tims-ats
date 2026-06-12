import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('pipeline module scope wiring', () => {
  it('movements.ts: getBoard probes the parent vacancy; movements probe applications', () => {
    const src = read('packages/api/src/routers/pipeline/movements.ts');
    expect(src).toMatch(/assertScoped\('vacancy'/);
    expect(src).toMatch(/assertScoped\('application'|scopeWhereFor\('application'/);
  });

  it('stages.ts: by-vacancy reads/mutations are scope-probed', () => {
    expect(read('packages/api/src/routers/pipeline/stages.ts')).toMatch(/assertScoped\('vacancy'|scopeWhereFor\('vacancy'/);
  });

  it('analytics.ts endpoints compose or probe', () => {
    expect(read('packages/api/src/routers/pipeline/analytics.ts')).toMatch(/assertScoped\('vacancy'|scopeWhereFor\('application'|scopeWhereFor\('vacancy'/);
  });

  it('no scope-fragment spreads anywhere in the module', () => {
    for (const f of ['movements.ts', 'stages.ts', 'analytics.ts']) {
      expect(read(`packages/api/src/routers/pipeline/${f}`)).not.toMatch(/\.\.\.(await\s+)?scopeWhere/);
    }
  });
});
