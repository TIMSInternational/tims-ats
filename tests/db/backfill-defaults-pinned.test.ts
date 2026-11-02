import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DEFAULT_ONBOARDING_TASKS,
  onboardingPhaseForOffset,
} from '../../packages/api/src/services/onboarding-defaults';
import { provisionOrgDefaults } from '../../packages/api/src/services/org-provisioning';
import { CONNECTOR_INPUTS, renderConnectorApply } from '../../scripts/db/backfills/connector-apply';

// ---------------------------------------------------------------------------
// The one-off backfills in scripts/db/backfills/ re-state code constants as SQL literals (psql cannot
// import TypeScript or C#). These tests pin every such literal to its source of truth, pin repeated
// SQL fragments to each other, and pin the generated connector files to their psql scripts — so a
// change on either side fails CI until the backfill is updated too.
// ---------------------------------------------------------------------------

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');
const BACKFILLS = 'scripts/db/backfills';
const ORG_PROV = 'services/Tims.Platform/src/Tims.Infrastructure/OrgProvisioning';

const SQL_288 = read(`${BACKFILLS}/288-org-roles-and-grants.sql`);
const SQL_319 = read(`${BACKFILLS}/319-onboarding-default-tasks.sql`);
const SQL_320 = read(`${BACKFILLS}/320-org-structure-defaults.sql`);
const CS_WRITER = read(`${ORG_PROV}/OrgProvisioningWriter.cs`);
const CS_ENTITIES = read(`${ORG_PROV}/OrgProvisioningEntities.cs`);
const CS_ROLES = read(`${ORG_PROV}/RoleAccessProvisioner.cs`);
const ROLE_GRANTS = JSON.parse(read(`${ORG_PROV}/role-grants.json`)) as {
  roles: Array<{ slug: string; name: string; description: string; grants: Array<Record<string, string>> }>;
};

function markedBlocks(sql: string, marker: string): string[] {
  const re = new RegExp(`-- BEGIN ${marker}\\n([\\s\\S]*?)-- END ${marker}`, 'g');
  return [...sql.matchAll(re)].map((m) => m[1]);
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const unquote = (s: string) => s.replace(/''/g, "'");
const snake = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

function insertColumns(sql: string, table: string): string[][] {
  const re = new RegExp(`INSERT INTO ${table}\\s*\\(([^)]*)\\)`, 'gi');
  return [...sql.matchAll(re)].map((m) => m[1].split(',').map((c) => c.trim().replace(/"/g, '')));
}

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

  it('every phase CASE (insert + due-offset rule) uses the thresholds of onboardingPhaseForOffset', () => {
    const re =
      /CASE WHEN d\.offset_days <= (\d+) THEN '(\w+)' WHEN d\.offset_days <= (\d+) THEN '(\w+)' ELSE '(\w+)' END/g;
    const matches = [...SQL_319.matchAll(re)];
    // the INSERT's phase + one inside each of the 3 DUE_OFFSET_RULE copies
    expect(matches).toHaveLength(4);
    for (const [, t1, p1, t2, p2, p3] of matches) {
      const sqlPhase = (n: number) => (n <= Number(t1) ? p1 : n <= Number(t2) ? p2 : p3);
      for (let offset = -30; offset <= 200; offset++) {
        expect(sqlPhase(offset)).toBe(onboardingPhaseForOffset(offset));
      }
    }
  });

  it('the phase-window fallback maps each phase to the LAST day of that window', () => {
    const fallback = /CASE t\.phase WHEN '(\w+)' THEN (\d+) WHEN '(\w+)' THEN (\d+) WHEN '(\w+)' THEN (\d+) END/g;
    const matches = [...SQL_319.matchAll(fallback)];
    expect(matches).toHaveLength(3);
    for (const m of matches) {
      const pairs: Array<[string, number]> = [
        [m[1], Number(m[2])],
        [m[3], Number(m[4])],
        [m[5], Number(m[6])],
      ];
      expect(pairs.map(([phase]) => phase)).toEqual(['day1_30', 'day31_60', 'day61_90']);
      for (const [phase, day] of pairs) expect(onboardingPhaseForOffset(day)).toBe(phase);
      expect(onboardingPhaseForOffset(pairs[0][1] + 1)).toBe('day31_60');
      expect(onboardingPhaseForOffset(pairs[1][1] + 1)).toBe('day61_90');
    }
  });
});

describe('#319 due-date rule for undated tasks', () => {
  const RULE = squash(`
    CASE
      WHEN t.phase IN ('day1_30', 'day31_60', 'day61_90') THEN
        CASE
          WHEN d.offset_days IS NOT NULL
           AND (CASE WHEN d.offset_days <= 30 THEN 'day1_30' WHEN d.offset_days <= 60 THEN 'day31_60' ELSE 'day61_90' END) = t.phase
            THEN d.offset_days
          ELSE CASE t.phase WHEN 'day1_30' THEN 30 WHEN 'day31_60' THEN 60 WHEN 'day61_90' THEN 90 END
        END
      ELSE d.offset_days
    END`);

  // Reference implementation of the documented rule (319 header, part B). The SQL text is pinned to
  // RULE above, so this table documents — and the SQL cannot silently stop matching — its behaviour.
  const PHASE_END: Record<string, number> = { day1_30: 30, day31_60: 60, day61_90: 90 };
  function dueOffset(title: string, phase: string): number | null {
    const def = DEFAULT_ONBOARDING_TASKS.find((t) => t.title === title)?.dueOffsetDays ?? null;
    if (phase in PHASE_END) {
      return def !== null && onboardingPhaseForOffset(def) === phase ? def : PHASE_END[phase];
    }
    return def;
  }

  it('the three copies (dry run x2, apply) are identical to the reviewed rule', () => {
    const blocks = markedBlocks(SQL_319, 'DUE_OFFSET_RULE');
    expect(blocks).toHaveLength(3);
    for (const block of blocks) expect(squash(block)).toBe(RULE);
  });

  it.each([
    ['Presentación con el equipo', 'day1_30', 5], // title match inside its window -> code offset
    ['Presentación con el equipo', 'day61_90', 90], // title match OUTSIDE the window -> window end wins
    ['Revisión de objetivos de 60 días', 'day31_60', 60],
    ['Revisión de objetivos de 60 días', 'day1_30', 30],
    ['Firmar contrato y documentos de ingreso', 'day1_30', -3],
    ['Tarea propia', 'day1_30', 30], // no title match -> window end
    ['Tarea propia', 'day31_60', 60],
    ['Tarea propia', 'day61_90', 90],
    ['Inscripción en nómina y beneficios', 'otra', 5], // unknown phase, title match -> code offset
    ['Tarea propia', 'otra', null], // unknown phase, no match -> left NULL (reported)
  ])('%s under %s -> %s', (title, phase, expected) => {
    expect(dueOffset(title, phase)).toBe(expected);
  });

  it('a title-matched offset is used only when it lies inside the task phase window', () => {
    for (const task of DEFAULT_ONBOARDING_TASKS) {
      for (const phase of Object.keys(PHASE_END)) {
        const inWindow = onboardingPhaseForOffset(task.dueOffsetDays) === phase;
        expect(dueOffset(task.title, phase)).toBe(inWindow ? task.dueOffsetDays : PHASE_END[phase]);
      }
    }
  });
});

describe('#319 eligibility: the dry run and the apply select complementary sets', () => {
  const PAST = "(p.start_date + interval '90 days' < (now() AT TIME ZONE 'UTC')) AS past_day90";
  const IN_WINDOW = "AND (v_include_past OR p.start_date + interval '90 days' >= v_now)";

  it('every dry-run past_day90 is start_date + 90 days < now (UTC)', () => {
    const defs = [...SQL_319.matchAll(/\(p\.start_date[^\n]*?\)\)\s+AS past_day90/g)].map((m) => squash(m[0]));
    expect(defs).toHaveLength(2);
    for (const def of defs) expect(def).toBe(PAST);
  });

  it('every apply PLAN_IN_WINDOW is the complement (>=) of the same expression, with v_now = now (UTC)', () => {
    const blocks = markedBlocks(SQL_319, 'PLAN_IN_WINDOW');
    // empty plans, the task-row lock (tier-1 review), the undated snapshot, the post-check.
    expect(blocks).toHaveLength(4);
    for (const block of blocks) expect(squash(block)).toBe(IN_WINDOW);
    expect(SQL_319).toContain("v_now           timestamp := now() AT TIME ZONE 'UTC';");
    const lhs = (s: string) => s.match(/p\.start_date \+ interval '90 days' (<|>=)/)?.[1];
    expect([lhs(PAST), lhs(IN_WINDOW)]).toEqual(['<', '>=']);
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

  it('TS provisioning writes only the columns the backfill writes (no leader, no extra fields)', async () => {
    const { company, unit, team } = await provisioned();
    expect(Object.keys(company).sort()).toEqual(['country', 'name', 'organizationId']);
    expect(Object.keys(unit).sort()).toEqual(['companyId', 'name', 'organizationId']);
    expect(Object.keys(team).sort()).toEqual(['businessUnitId', 'name', 'organizationId']);
    expect(company.name).toBe('Org Name');
    expect(SQL_320).toMatch(/SELECT o\.id AS organization_id, o\.name AS company_name,/);
    expect(SQL_320).not.toMatch(/INSERT INTO (user_teams|user_business_units)/);
    expect(SQL_320).not.toMatch(/SET\s+leader_id/i);
  });

  it.each([
    ['CompanyWriteEntity', 'companies'],
    ['BusinessUnitWriteEntity', 'business_units'],
    ['TeamWriteEntity', 'teams'],
  ])('C# %s: the columns the writer sets (+created_at) equal the backfill INSERT INTO %s columns', (entity, table) => {
    const init = CS_WRITER.match(new RegExp(`new ${entity}\\s*\\{([^}]*)\\}`));
    expect(init).not.toBeNull();
    const assigned = [...init![1].matchAll(/(\w+)\s*=/g)].map((m) => snake(m[1]));
    const declared = [
      ...(CS_ENTITIES.match(new RegExp(`class ${entity}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1] ?? '').matchAll(
        /public \S+ (\w+) \{ get; set; \}/g,
      ),
    ].map((m) => snake(m[1]));
    // The entity maps no column the initializer leaves out (so EF cannot write an unseen default).
    expect(declared.sort()).toEqual([...assigned].sort());
    const inserts = insertColumns(SQL_320, table);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].sort()).toEqual([...assigned, 'created_at'].sort());
  });

  it('the dry-run expected_orgs predicate is the same text as the apply TARGET_PREDICATE', () => {
    const blocks320 = markedBlocks(SQL_320, 'TARGET_PREDICATE');
    expect(blocks320).toHaveLength(2);
    expect(squash(blocks320[0])).toBe(squash(blocks320[1]));
  });
});

describe('#288 backfill pins role-grants.json and RoleAccessProvisioner (C#)', () => {
  const grantsCount = ROLE_GRANTS.roles.reduce((n, r) => n + r.grants.length, 0);

  it('every embedded ROLE_GRANTS_JSON block parses to exactly role-grants.json', () => {
    const blocks = markedBlocks(SQL_288, 'ROLE_GRANTS_JSON');
    expect(blocks).toHaveLength(2);
    for (const block of blocks) {
      const m = block.match(/^\$grants\$\n([\s\S]*)\n\$grants\$\n$/);
      expect(m).not.toBeNull();
      expect(JSON.parse(m![1])).toEqual(ROLE_GRANTS);
    }
  });

  it('the apply spec-size guard equals the JSON role and grant counts', () => {
    const guard = SQL_288.match(/IF v_spec_roles <> (\d+) OR v_spec_grants <> (\d+) THEN/);
    expect(guard).not.toBeNull();
    expect([Number(guard![1]), Number(guard![2])]).toEqual([ROLE_GRANTS.roles.length, grantsCount]);
  });

  it.each([
    ['roles', 'roles', ['created_at']],
    ['permissions', 'permissions', ['created_at']],
    ['role_permissions', 'role_permissions', ['created_at']],
  ])('INSERT INTO %s writes the C# column set (+created_at)', (table, csTable, extra) => {
    const cs = insertColumns(CS_ROLES, csTable);
    expect(cs).toHaveLength(1);
    const sql = insertColumns(SQL_288, table);
    expect(sql).toHaveLength(1);
    expect(sql[0].sort()).toEqual([...cs[0], ...extra].sort());
  });

  it('uses the same ON CONFLICT targets as the C# provisioner, and is_system true', () => {
    for (const target of ['(organization_id, slug)', '(module, action)', '(role_id, permission_id)']) {
      expect(squash(CS_ROLES).replace(/ /g, '')).toContain(`ONCONFLICT${target.replace(/ /g, '')}DONOTHING`);
      expect(SQL_288).toContain(`ON CONFLICT ${target} DO NOTHING`);
    }
    expect(CS_ROLES).toMatch(/item\.value->>'description',true,/);
    expect(SQL_288).toMatch(/sr\.name, sr\.slug, sr\.description, true, v_now, v_now/);
    expect(CS_ROLES).toContain("code.module || '.' || code.action");
    expect(SQL_288).toContain("c.module || '.' || c.action");
    expect(SQL_288).not.toMatch(/INSERT INTO user_roles/);
  });

  it('the dry-run expected_orgs predicate is the same text as the apply TARGET_PREDICATE', () => {
    const blocks = markedBlocks(SQL_288, 'TARGET_PREDICATE');
    expect(blocks).toHaveLength(2);
    expect(squash(blocks[0])).toBe(squash(blocks[1]));
  });
});

describe('apply-via-connector files are generated from the psql scripts', () => {
  const CONNECTOR_DIR = `${BACKFILLS}/apply-via-connector`;

  it('there is exactly one connector file per CONNECTOR_INPUTS entry', () => {
    const files = readdirSync(resolve(ROOT, CONNECTOR_DIR)).sort();
    expect(files).toEqual(
      Object.keys(CONNECTOR_INPUTS)
        .map((name) => `${name}.sql`)
        .sort(),
    );
  });

  it.each(Object.keys(CONNECTOR_INPUTS))('%s.sql equals a fresh render of its psql script', (name) => {
    const rendered = renderConnectorApply(name, read(`${BACKFILLS}/${name}.sql`), CONNECTOR_INPUTS[name]);
    expect(read(`${CONNECTOR_DIR}/${name}.sql`)).toBe(rendered);
    expect(rendered).not.toMatch(/^\s*\\/m);
    expect(rendered).toMatch(/^BEGIN;$/m);
    expect(rendered).toMatch(/^COMMIT;$/m);
    expect(rendered).toContain('rolbypassrls');
  });

  it('inlines only true/false/integer literals and rejects anything else', () => {
    const src = "x\n-- CONNECTOR-APPLY-BEGIN\nSELECT :'n';\n-- CONNECTOR-APPLY-END\n";
    expect(renderConnectorApply('t', src, { n: '7' })).toContain("SELECT '7';");
    expect(() => renderConnectorApply('t', src, { n: "1'; DROP TABLE x; --" })).toThrow(/not true\/false\/integer/);
    expect(() => renderConnectorApply('t', src, {})).toThrow(/no CONNECTOR_INPUTS value/);
    expect(() => renderConnectorApply('t', src, { n: '1', m: '2' })).toThrow(/not referenced/);
    expect(() => renderConnectorApply('t', src.replace('SELECT', '\\gset\nSELECT'), { n: '1' })).toThrow(
      /unsupported psql meta-command/,
    );
  });
});
