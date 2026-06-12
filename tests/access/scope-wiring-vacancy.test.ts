import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Wave 2.5 slice 3 — static tripwires: every vacancy read composes the scope
// fragment via AND, every by-id mutation probes via assertScoped (or composes
// the fragment into its existing org-probe). Behavior of the fragments
// themselves is covered by tests/access/entity-policies.test.ts.
const ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, 'packages/api/src/routers/vacancy', p), 'utf8');

describe('vacancy module scope wiring', () => {
  it('crud.ts: list composes scopeWhereFor inside AND', () => {
    const src = read('crud.ts');
    expect(src).toMatch(/scopeWhereFor\('vacancy'/);
    expect(src).toMatch(/AND:\s*\[/);
  });

  it('crud.ts: getById + update/close/freeze/duplicate are scope-probed', () => {
    const src = read('crud.ts');
    expect((src.match(/assertScoped\('vacancy'/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it('approvals.ts, channels.ts, job-profile.ts: by-id mutations are scope-probed', () => {
    for (const f of ['approvals.ts', 'channels.ts', 'job-profile.ts']) {
      expect(read(f)).toMatch(/assertScoped\('vacancy'|scopeWhereFor\('vacancy'/);
    }
  });

  it('stats.ts: aggregates compose the fragment (leaders see team stats)', () => {
    expect(read('stats.ts')).toMatch(/scopeWhereFor\('vacancy'/);
  });

  it('no file spreads a scope fragment (AND-composition, CI check 13)', () => {
    for (const f of ['crud.ts', 'approvals.ts', 'channels.ts', 'job-profile.ts', 'stats.ts']) {
      expect(read(f)).not.toMatch(/\.\.\.(await\s+)?scopeWhere/);
    }
  });
});
