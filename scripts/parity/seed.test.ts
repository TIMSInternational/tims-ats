import { describe, it, expect } from 'vitest';
import type { Client } from 'pg';
import { planSeed, isParityTestEmail, seedOrgStructureWritePreconditions, type SeedResources } from './seed';
import { SURFACES } from './surfaces';

describe('planSeed', () => {
  it('produces 2 orgs and a user per configured role, deterministic emails', () => {
    const plan = planSeed(['org_admin', 'manager']);
    expect(plan.orgs).toEqual(['__parity_a', '__parity_b']);
    expect(plan.users).toHaveLength(4); // 2 orgs x 2 roles
    expect(plan.users.map((u) => u.email)).toContain('parity+a-org_admin@tims.test');
    expect(new Set(plan.users.map((u) => u.email)).size).toBe(4); // unique
  });
});

describe('isParityTestEmail', () => {
  it('matches deterministic seeded parity emails for both orgs', () => {
    expect(isParityTestEmail('parity+a-org_admin@tims.test')).toBe(true);
    expect(isParityTestEmail('parity+b-manager@tims.test')).toBe(true);
  });

  it('rejects non-parity, wrong-org, wrong-domain, and empty emails', () => {
    expect(isParityTestEmail('someone@tims.test')).toBe(false);
    expect(isParityTestEmail('parity+c-x@tims.test')).toBe(false);
    expect(isParityTestEmail('parity+a-x@example.com')).toBe(false);
    expect(isParityTestEmail('')).toBe(false);
  });
});

describe('SeedResources covers every idScopeKey the read registry uses', () => {
  /**
   * `cli.ts`'s `pairFor` looks a by-id endpoint's `idScopeKey` up in the resolved `SeedResources` bag
   * with a `keyof SeedResources` cast, and THROWS at run time — mid-`verify`, against live prod —
   * when the key is absent. Nothing checked the two agreed.
   *
   * This object is exhaustive BY TYPE: `Record<keyof SeedResources, true>` fails `tsc` if a key is
   * added to the interface and not listed here, or listed here and not in the interface. The loop
   * below then closes the other direction at run time.
   *
   * HALF OF THIS GUARD IS COMPILE-TIME ONLY, and that is worth stating rather than discovering.
   * Deleting a key from `SeedResources` is caught by `tsc --noEmit` (two errors: here, and at
   * `resolveResources`'s return literal) — NOT by vitest, which does not type-check. Both run in the
   * gate, so the guard holds; but do not read a green vitest as having exercised it. The runtime half
   * (the loop below) is what catches the other direction: a registry endpoint naming a key that does
   * not exist. `resolveResources` itself cannot be unit-tested — it needs a live seeded DB.
   */
  const SEED_RESOURCE_KEYS: Record<keyof SeedResources, true> = {
    employee: true,
    'eval-cycle-staff': true,
    'eval-cycle-self': true,
    calibration: true,
    'critical-role': true,
    // #195, 2026-08-11 — threaded into SURFACES['organization'].detail.
    organization: true,
    // #195 residual, 2026-08-17 — the 'Parity Team A1'/'B1' pair, threaded by the re-registered
    // team-intel surface's by-id trio (profile/members/balance-score).
    team: true,
  };

  it('every by-id endpoint names a resource key resolveResources actually returns', () => {
    let seen = 0;
    for (const [surfaceKey, surface] of Object.entries(SURFACES)) {
      for (const ep of surface.endpoints) {
        if (!ep.idScopeKey) continue;
        seen++;
        expect(
          Object.prototype.hasOwnProperty.call(SEED_RESOURCE_KEYS, ep.idScopeKey),
          `${surfaceKey}/${ep.name}: idScopeKey "${ep.idScopeKey}" is not a SeedResources key — cli.ts's pairFor would throw mid-verify`,
        ).toBe(true);
      }
    }
    // Non-vacuity: eleven by-id endpoints today — compensation/employee, ninebox/axis-breakdown,
    // organization/detail, plus the eight added by the 2026-08-17 re-registrations (team-intel 3,
    // succession 3, evaluation360 2) — the same set surfaces.test.ts pins. If this loop goes empty
    // the assertion above stops being a guard while still reading as one.
    expect(seen).toBe(11);
  });
});

describe('seedOrgStructureWritePreconditions — the fixture reset is ONE transaction (PR #341 MED-2)', () => {
  /**
   * The reset wipes every membership/assignment on the fixed org-structure rows and then re-inserts the DELETE
   * endpoints' preconditions. As autocommit statements, a failure between the two committed a half-reset
   * fixture (the org-B rows the DELETE IDOR read-backs require to survive were gone). These pin the boundary
   * with a recording fake `pg.Client` — no database needed.
   */
  type Call = { sql: string; params?: unknown[] };
  const fakeDb = (failOn?: (sql: string) => boolean, rollbackThrows = false) => {
    const calls: Call[] = [];
    const db = {
      query: async (sql: string, params?: unknown[]) => {
        calls.push({ sql, params });
        if (sql === 'ROLLBACK' && rollbackThrows) throw new Error('connection terminated');
        if (failOn?.(sql)) throw new Error('boom: simulated mid-reset failure');
        return { rows: [{ id: '00000000-0000-4000-8000-00000000000f' }] };
      },
    };
    return { db: db as unknown as Client, calls };
  };
  const norm = (sql: string) => sql.replace(/\s+/g, ' ').trim();

  it('wraps every statement in BEGIN … COMMIT and issues no ROLLBACK on success', async () => {
    const { db, calls } = fakeDb();
    await seedOrgStructureWritePreconditions(db, 'ORG_A', 'ORG_B');
    expect(calls[0].sql).toBe('BEGIN');
    expect(calls[calls.length - 1].sql).toBe('COMMIT');
    expect(calls.filter((c) => c.sql === 'BEGIN')).toHaveLength(1);
    expect(calls.filter((c) => c.sql === 'COMMIT')).toHaveLength(1);
    expect(calls.some((c) => c.sql === 'ROLLBACK')).toBe(false);
    // The reset did real work inside the boundary (not an empty transaction).
    expect(calls.length).toBeGreaterThan(10);
  });

  it('wipes memberships/assignments BEFORE re-inserting them, both inside the same transaction', async () => {
    const { db, calls } = fakeDb();
    await seedOrgStructureWritePreconditions(db, 'ORG_A', 'ORG_B');
    const sqls = calls.map((c) => norm(c.sql));
    const wipeTeams = sqls.findIndex((s) => s.startsWith('DELETE FROM user_teams WHERE team_id = ANY($1)'));
    const wipeUnits = sqls.findIndex((s) => s.startsWith('DELETE FROM user_business_units WHERE business_unit_id = ANY($1)'));
    const insTeams = sqls.findIndex((s) => s.startsWith('INSERT INTO user_teams'));
    const insUnits = sqls.findIndex((s) => s.startsWith('INSERT INTO user_business_units'));
    for (const i of [wipeTeams, wipeUnits, insTeams, insUnits]) expect(i).toBeGreaterThan(0);
    expect(wipeTeams).toBeLessThan(insTeams);
    expect(wipeUnits).toBeLessThan(insUnits);
    expect(Math.max(insTeams, insUnits)).toBeLessThan(sqls.lastIndexOf('COMMIT'));
  });

  it('a failure AFTER the wipe rolls the whole reset back, never commits, and re-throws the original error', async () => {
    const { db, calls } = fakeDb((sql) => norm(sql).startsWith('INSERT INTO user_business_units'));
    await expect(seedOrgStructureWritePreconditions(db, 'ORG_A', 'ORG_B')).rejects.toThrow('simulated mid-reset failure');
    const sqls = calls.map((c) => norm(c.sql));
    // The wipe DID run before the failure — exactly the half-reset state the transaction must undo.
    expect(sqls.some((s) => s.startsWith('DELETE FROM user_teams'))).toBe(true);
    expect(sqls[sqls.length - 1]).toBe('ROLLBACK');
    expect(sqls).not.toContain('COMMIT');
  });

  it('a ROLLBACK that itself fails (dead connection) does not mask the original error', async () => {
    const { db, calls } = fakeDb((sql) => norm(sql).startsWith('INSERT INTO user_teams'), true);
    await expect(seedOrgStructureWritePreconditions(db, 'ORG_A', 'ORG_B')).rejects.toThrow('simulated mid-reset failure');
    expect(calls.map((c) => c.sql)).not.toContain('COMMIT');
    expect(calls[calls.length - 1].sql).toBe('ROLLBACK');
  });
});
