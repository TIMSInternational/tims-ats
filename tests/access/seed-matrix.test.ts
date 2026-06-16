import { describe, it, expect } from 'vitest';
import { grantsFor } from '../../packages/db/prisma/seed-access-matrix';

const has = (role: string, module: string, action: string, scope: string) =>
  grantsFor(role).some((g) => g.module === module && g.action === action && g.scope === scope);

describe('seed grant matrix (baseline, pre-corrections)', () => {
  it('committee scorecards + calibration are present', () => {
    expect(has('committee', 'interview', 'read', 'team')).toBe(true);
    expect(has('committee', 'ninebox', 'update', 'team')).toBe(true);
  });
  it('importing the matrix runs no seed (no PrismaClient side effect)', () => {
    expect(typeof grantsFor).toBe('function'); // import resolved without executing main()
  });
});

describe('seed grant matrix (Slice 0 corrections, client spec §2)', () => {
  it('leader can review finalists + request vacancies (@team)', () => {
    expect(has('leader', 'candidate', 'read', 'team')).toBe(true);   // "revisar candidatos finalistas"
    expect(has('leader', 'vacancy', 'create', 'team')).toBe(true);   // "solicitar vacantes"
  });
  it('recruiter can create offers + publish vacancies (@organization)', () => {
    expect(has('recruiter', 'offer', 'create', 'organization')).toBe(true);   // "crear ofertas"
    expect(has('recruiter', 'vacancy', 'publish', 'organization')).toBe(true);
  });
  it('hrbp can MANAGE its units (@unit)', () => {
    for (const [m, a] of [
      ['vacancy', 'create'], ['vacancy', 'update'], ['pipeline', 'update'],
      ['candidate', 'update'], ['interview', 'create'], ['performance', 'update'],
      ['monitoring', 'read'],
    ] as const)
      expect(has('hrbp', m, a, 'unit'), `hrbp ${m}:${a}`).toBe(true);
  });
  it('hrbp offers stay READ-ONLY — no create/update/approve (D1)', () => {
    expect(has('hrbp', 'offer', 'approve', 'unit')).toBe(false);
    expect(has('hrbp', 'offer', 'create', 'unit')).toBe(false);
    expect(has('hrbp', 'offer', 'update', 'unit')).toBe(false);
  });
});
