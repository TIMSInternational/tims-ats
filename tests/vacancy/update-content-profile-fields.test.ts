import { describe, it, expect, vi, beforeEach } from 'vitest';

// Codex round 10 on #421 (P2): updateJobProfile's competencies and the other job-profile fields sent with
// them must land in ONE transaction — the same jobProfile upsert inside vacancyLifecycleRepository.updateContent.
const tx = vi.hoisted(() => ({
  vacancy: { updateMany: vi.fn(), findFirstOrThrow: vi.fn() },
  jobProfile: { upsert: vi.fn() },
  auditLog: { create: vi.fn() },
}));
const runTenantTransaction = vi.hoisted(() =>
  vi.fn(async (_org: string, fn: (t: unknown) => Promise<unknown>) => fn(tx)),
);
vi.mock('@tims/db', async () => {
  const actual = await vi.importActual<typeof import('@tims/db')>('@tims/db');
  return { ...actual, runTenantTransaction };
});

import { vacancyLifecycleRepository } from '../../packages/api/src/repositories/vacancy-lifecycle.repository';

const ORG = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const VACANCY = '44444444-4444-4444-8444-444444444444';

beforeEach(() => {
  vi.clearAllMocks();
  tx.vacancy.updateMany.mockResolvedValue({ count: 1 });
  tx.vacancy.findFirstOrThrow.mockResolvedValue({ id: VACANCY });
  tx.jobProfile.upsert.mockResolvedValue({ id: 'jp-1' });
});

describe('vacancyLifecycleRepository.updateContent with profile fields', () => {
  it('writes competencies and the other profile fields in the same upsert, in the same transaction', async () => {
    await vacancyLifecycleRepository.updateContent(
      ORG,
      VACANCY,
      {},
      ['competencies', 'kpis'],
      { userId: 'u1', actorId: 'u1' },
      [{ name: 'Liderazgo', level: 3, scaleMax: 5 }],
      { kpis: [{ name: 'NPS' }] },
    );
    expect(runTenantTransaction).toHaveBeenCalledTimes(1);
    expect(tx.jobProfile.upsert).toHaveBeenCalledTimes(1);
    const args = tx.jobProfile.upsert.mock.calls[0]![0];
    expect(args.update).toEqual({ kpis: [{ name: 'NPS' }], competencies: [{ name: 'Liderazgo', level: 3, scaleMax: 5 }] });
    expect(args.create).toMatchObject({ organizationId: ORG, vacancyId: VACANCY, kpis: [{ name: 'NPS' }] });
  });

  it('writes nothing when the vacancy is not editable', async () => {
    tx.vacancy.updateMany.mockResolvedValue({ count: 0 });
    const row = await vacancyLifecycleRepository.updateContent(
      ORG, VACANCY, {}, ['competencies', 'kpis'], { userId: 'u1', actorId: 'u1' }, [], { kpis: [] },
    );
    expect(row).toBeNull();
    expect(tx.jobProfile.upsert).not.toHaveBeenCalled();
  });
});
