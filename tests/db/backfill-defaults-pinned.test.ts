import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DEFAULT_ONBOARDING_TASKS,
  onboardingPhaseForOffset,
} from '../../packages/api/src/services/onboarding-defaults';
import { provisionOrgDefaults } from '../../packages/api/src/services/org-provisioning';

// ---------------------------------------------------------------------------
// The one-off backfills in scripts/db/backfills/ re-state code constants as SQL literals (psql cannot
// import TypeScript). These tests pin every such literal to its source of truth, so changing the
// default checklist or the provisioned org structure fails CI until the backfill is updated too.
// ---------------------------------------------------------------------------

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const SQL_319 = read('scripts/db/backfills/319-onboarding-default-tasks.sql');
const SQL_320 = read('scripts/db/backfills/320-org-structure-defaults.sql');
const CS_WRITER = read('services/Tims.Platform/src/Tims.Infrastructure/OrgProvisioning/OrgProvisioningWriter.cs');

function markedBlocks(sql: string, marker: string): string[] {
  const re = new RegExp(`-- BEGIN ${marker}\\n([\\s\\S]*?)-- END ${marker}`, 'g');
  return [...sql.matchAll(re)].map((m) => m[1]);
}

const unquote = (s: string) => s.replace(/''/g, "'");

function parseTaskRows(block: string) {
  const re = /\(\s*(-?\d+),\s*'((?:[^']|'')*)',\s*'([a-z_]+)',\s*(-?\d+)\s*\)/g;
  return [...block.matchAll(re)].map((m) => ({
    order: Number(m[1]),
    title: unquote(m[2]),
    responsible: m[3],
    dueOffsetDays: Number(m[4]),
  }));
}

const expectedRows = DEFAULT_ONBOARDING_TASKS.map((task, order) => ({
  order,
  title: task.title,
  responsible: task.responsible,
  dueOffsetDays: task.dueOffsetDays,
}));

describe('#319 backfill pins DEFAULT_ONBOARDING_TASKS', () => {
  const blocks = markedBlocks(SQL_319, 'DEFAULT_ONBOARDING_TASKS');

  it('restates the default checklist in all three places (dry run x2, apply)', () => {
    expect(blocks).toHaveLength(3);
  });

  it.each([0, 1, 2])('block %i equals DEFAULT_ONBOARDING_TASKS (order, title, owner, offset)', (i) => {
    expect(parseTaskRows(blocks[i])).toEqual(expectedRows);
  });

  it('the unresolvable-task report excludes exactly the default titles', () => {
    const titleBlocks = markedBlocks(SQL_319, 'DEFAULT_ONBOARDING_TITLES');
    expect(titleBlocks).toHaveLength(1);
    const titles = [...titleBlocks[0].matchAll(/'((?:[^']|'')*)'/g)].map((m) => unquote(m[1]));
    expect(titles).toEqual(DEFAULT_ONBOARDING_TASKS.map((t) => t.title));
  });

  it('the apply guard expects exactly DEFAULT_ONBOARDING_TASKS.length defaults', () => {
    const guard = SQL_319.match(/IF v_defaults <> (\d+) THEN/);
    expect(guard).not.toBeNull();
    expect(Number(guard![1])).toBe(DEFAULT_ONBOARDING_TASKS.length);
  });

  it('the inserted phase uses the same thresholds as onboardingPhaseForOffset', () => {
    const m = SQL_319.match(
      /CASE WHEN d\.offset_days <= (\d+) THEN '(\w+)' WHEN d\.offset_days <= (\d+) THEN '(\w+)' ELSE '(\w+)' END/,
    );
    expect(m).not.toBeNull();
    const [, t1, p1, t2, p2, p3] = m!;
    const sqlPhase = (n: number) => (n <= Number(t1) ? p1 : n <= Number(t2) ? p2 : p3);
    for (let offset = -30; offset <= 200; offset++) {
      expect(sqlPhase(offset)).toBe(onboardingPhaseForOffset(offset));
    }
  });

  it('the undated-task fallback maps each phase to the LAST day of that phase window', () => {
    const fallback = /CASE t\.phase WHEN '(\w+)' THEN (\d+) WHEN '(\w+)' THEN (\d+) WHEN '(\w+)' THEN (\d+) END/g;
    const matches = [...SQL_319.matchAll(fallback)];
    // dry run 1, dry run 2, apply target set (x2: offset + eligibility)
    expect(matches.length).toBeGreaterThanOrEqual(4);
    for (const m of matches) {
      const pairs: Array<[string, number]> = [
        [m[1], Number(m[2])],
        [m[3], Number(m[4])],
        [m[5], Number(m[6])],
      ];
      expect(pairs.map(([phase]) => phase)).toEqual(['day1_30', 'day31_60', 'day61_90']);
      for (const [phase, day] of pairs) {
        expect(onboardingPhaseForOffset(day)).toBe(phase);
      }
      // 30 and 60 are window ENDS: one day later is the next phase.
      expect(onboardingPhaseForOffset(pairs[0][1] + 1)).toBe('day31_60');
      expect(onboardingPhaseForOffset(pairs[1][1] + 1)).toBe('day61_90');
    }
  });
});

describe('#320 backfill pins provisionOrgDefaults (TS) and OrgProvisioningWriter (C#)', () => {
  const blocks = markedBlocks(SQL_320, 'ORG_DEFAULTS');
  const sqlConst = (name: string) => {
    expect(blocks).toHaveLength(1);
    const m = blocks[0].match(new RegExp(`${name}\\s+CONSTANT text := '((?:[^']|'')*)';`));
    expect(m).not.toBeNull();
    return unquote(m![1]);
  };

  async function provisioned() {
    const tx = {
      company: { create: vi.fn().mockResolvedValue({ id: 'company-1' }) },
      businessUnit: { create: vi.fn().mockResolvedValue({ id: 'bu-1' }) },
      team: { create: vi.fn().mockResolvedValue({ id: 'team-1' }) },
    };
    await provisionOrgDefaults(tx as never, 'org-1', 'Org Name');
    return {
      company: tx.company.create.mock.calls[0][0].data as Record<string, unknown>,
      unit: tx.businessUnit.create.mock.calls[0][0].data as Record<string, unknown>,
      team: tx.team.create.mock.calls[0][0].data as Record<string, unknown>,
    };
  }

  const csConst = (name: string) => {
    const m = CS_WRITER.match(new RegExp(`public const string ${name} = "([^"]*)";`));
    expect(m).not.toBeNull();
    return m![1];
  };

  it('country equals the TS payload and the C# DefaultCountry', async () => {
    const { company } = await provisioned();
    expect(sqlConst('c_country')).toBe(company.country);
    expect(sqlConst('c_country')).toBe(csConst('DefaultCountry'));
  });

  it('business unit name equals the TS payload and the C# DefaultBusinessUnit', async () => {
    const { unit } = await provisioned();
    expect(sqlConst('c_unit')).toBe(unit.name);
    expect(sqlConst('c_unit')).toBe(csConst('DefaultBusinessUnit'));
  });

  it('team name equals the TS payload and the C# DefaultTeam', async () => {
    const { team } = await provisioned();
    expect(sqlConst('c_team')).toBe(team.name);
    expect(sqlConst('c_team')).toBe(csConst('DefaultTeam'));
  });

  it('provisioning still writes only the columns the backfill writes (no leader, no extra fields)', async () => {
    const { company, unit, team } = await provisioned();
    expect(Object.keys(company).sort()).toEqual(['country', 'name', 'organizationId']);
    expect(Object.keys(unit).sort()).toEqual(['companyId', 'name', 'organizationId']);
    expect(Object.keys(team).sort()).toEqual(['businessUnitId', 'name', 'organizationId']);
    // The company is named after the organization, as the backfill does with organizations.name.
    expect(company.name).toBe('Org Name');
    expect(SQL_320).toMatch(/SELECT o\.id AS organization_id, o\.name AS company_name,/);
    // And the backfill never assigns a leader or a member.
    expect(SQL_320).not.toMatch(/INSERT INTO (user_teams|user_business_units)/);
    expect(SQL_320).not.toMatch(/SET\s+leader_id/i);
  });
});
