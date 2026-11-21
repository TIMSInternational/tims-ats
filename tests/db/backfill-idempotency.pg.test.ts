/**
 * #288 / #319 / #320 — the one-off backfills, EXECUTED against a real PostgreSQL cluster.
 *
 * backfill-defaults-pinned.test.ts pins every literal to its source; this file proves the behaviour
 * the owner relies on before (and, for #288, after) a production apply:
 *
 *   1. the dry run's totals are what the apply then writes;
 *   2. a RE-RUN IS A NO-OP — after an apply the dry run reports 0, and an apply with 0 leaves every
 *      touched table byte-identical (row-level md5, including updated_at);
 *   3. a re-run with the ORIGINAL (now stale) totals aborts with exit 3 and writes nothing — which is
 *      exactly what re-sending the committed apply-via-connector/288 file to production would do now
 *      that #288 has been applied there;
 *   4. the refusal paths: invalid flag values, a role without BYPASSRLS.
 *
 * OPT-IN. Set BACKFILL_PG_BIN to a directory holding initdb / pg_ctl / psql (PostgreSQL >= 13), e.g.
 *   BACKFILL_PG_BIN=/opt/homebrew/opt/postgresql@17/bin npx vitest run tests/db/backfill-idempotency.pg.test.ts
 * Without it the suite is skipped (the repo deliberately does not make `npx vitest run` depend on a
 * local PostgreSQL install — see tests/db/pre-flip-scan.test.ts). It never reads DATABASE_URL /
 * DIRECT_URL / PG* from the environment: every psql call targets the throwaway cluster this file
 * creates on 127.0.0.1 (TCP only, trust auth, random free port) and tears down afterwards.
 *
 * FIXTURE DDL. Hand-written to mirror the Prisma models the scripts touch (organization.prisma,
 * rbac.prisma, onboarding.prisma: column names, nullability, defaults, timestamp(3), the unique keys the
 * ON CONFLICT targets need, and the FKs). Only the columns the scripts read or write are present; the
 * tables carry FORCE RLS with a deny-by-default policy, like production, so the BYPASSRLS guard is real.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONNECTOR_INPUTS, renderConnectorApply } from '../../scripts/db/backfills/connector-apply';

const PG_BIN = process.env.BACKFILL_PG_BIN ?? '';
const ENABLED = PG_BIN !== '' && ['initdb', 'pg_ctl', 'psql'].every((b) => existsSync(join(PG_BIN, b)));
const suite = ENABLED ? describe : describe.skip;

const ROOT = resolve(__dirname, '../..');
const BACKFILLS = join(ROOT, 'scripts/db/backfills');
const SCRIPT = {
  288: join(BACKFILLS, '288-org-roles-and-grants.sql'),
  319: join(BACKFILLS, '319-onboarding-default-tasks.sql'),
  320: join(BACKFILLS, '320-org-structure-defaults.sql'),
} as const;
const ROLE_GRANTS = JSON.parse(
  readFileSync(join(ROOT, 'services/Tims.Platform/src/Tims.Infrastructure/OrgProvisioning/role-grants.json'), 'utf8'),
) as { roles: Array<{ slug: string; grants: Array<{ module: string; action: string }> }> };

let dir = '';
let port = 0;

/** A minimal child env: nothing that could point psql anywhere but the throwaway cluster. */
function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    NODE_ENV: process.env.NODE_ENV ?? 'test',
    PGCONNECT_TIMEOUT: '5',
    // Without a valid locale the macOS postmaster aborts ("postmaster became multithreaded during startup").
    LC_ALL: 'C',
    // A non-UTC client zone on purpose: the applies must pin TimeZone = 'UTC' themselves (LOW-2).
    PGTZ: 'America/Bogota',
    ...extra,
  };
}

type Run = { code: number; out: string };

function psql(db: string, args: string[], user = 'postgres'): Run {
  const r = spawnSync(
    join(PG_BIN, 'psql'),
    ['-X', '-A', '-h', '127.0.0.1', '-p', String(port), '-U', user, '-d', db, '-v', 'ON_ERROR_STOP=1', ...args],
    { encoding: 'utf8', env: childEnv() },
  );
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function sql(db: string, text: string): string {
  const r = psql(db, ['-t', '-c', text]);
  if (r.code !== 0) throw new Error(`fixture SQL failed (${r.code}): ${r.out}`);
  return r.out.trim();
}

function runScript(db: string, file: string, vars: Record<string, string> = {}, user = 'postgres'): Run {
  const v = Object.entries(vars).flatMap(([k, val]) => ['-v', `${k}=${val}`]);
  return psql(db, [...v, '-f', file], user);
}

/** Values of a one-row result set, found by its header line in psql unaligned (-A) output. */
function resultRow(out: string, header: string): Record<string, number> {
  const lines = out.split('\n');
  const i = lines.indexOf(header);
  if (i < 0) throw new Error(`header ${header} not in output:\n${out}`);
  const keys = header.split('|');
  const vals = lines[i + 1].split('|').map(Number);
  return Object.fromEntries(keys.map((k, j) => [k, vals[j]]));
}

/** Row-level fingerprint of every table a backfill can touch: equal fingerprints = nothing written. */
function snapshot(db: string, tables: string[]): string {
  return sql(
    db,
    tables
      .map(
        (t) =>
          `SELECT '${t}' || ':' || count(*) || ':' || md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) FROM ${t} x`,
      )
      .join(' UNION ALL ') + ' ORDER BY 1',
  );
}

async function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.once('error', fail);
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => ok(p));
    });
  });
}

const RLS_TABLES = [
  'organizations',
  'companies',
  'business_units',
  'teams',
  'roles',
  'role_permissions',
  'user_roles',
  'onboarding_plans',
  'onboarding_tasks',
  'onboarding_check_ins',
  'users',
  'user_teams',
  'user_business_units',
  'vacancies',
];

const DDL = `
CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, slug text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true, created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp(3) NOT NULL, deleted_at timestamp(3));
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  is_active boolean NOT NULL DEFAULT true, deleted_at timestamp(3));
CREATE TABLE companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL, country text NOT NULL, currency text NOT NULL DEFAULT 'USD',
  timezone text NOT NULL DEFAULT 'America/Bogota', language text NOT NULL DEFAULT 'es',
  legal_name text, tax_id text, settings jsonb NOT NULL DEFAULT '{}', is_active boolean NOT NULL DEFAULT true,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at timestamp(3) NOT NULL);
CREATE TABLE business_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE, name text NOT NULL, code text,
  parent_id uuid REFERENCES business_units(id), settings jsonb NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true, created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp(3) NOT NULL);
CREATE TABLE teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  business_unit_id uuid NOT NULL REFERENCES business_units(id) ON DELETE CASCADE, name text NOT NULL,
  leader_id uuid REFERENCES users(id), settings jsonb NOT NULL DEFAULT '{}', is_active boolean NOT NULL DEFAULT true,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at timestamp(3) NOT NULL);
CREATE TABLE user_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE, role text NOT NULL DEFAULT 'member',
  UNIQUE (user_id, team_id));
CREATE TABLE user_business_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_unit_id uuid NOT NULL REFERENCES business_units(id) ON DELETE CASCADE, UNIQUE (user_id, business_unit_id));
CREATE TABLE vacancies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  business_unit_id uuid, team_id uuid, deleted_at timestamp(3));
CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL, slug text NOT NULL, description text, is_system boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true, created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp(3) NOT NULL, UNIQUE (organization_id, slug));
CREATE TABLE permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), module text NOT NULL, action text NOT NULL, description text,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE (module, action));
CREATE TABLE role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE, scope text NOT NULL DEFAULT 'own',
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE (role_id, permission_id));
CREATE TABLE user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE, unit_scope uuid, UNIQUE (user_id, role_id));
CREATE TABLE onboarding_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, start_date timestamp(3) NOT NULL,
  status text NOT NULL DEFAULT 'active');
CREATE TABLE onboarding_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  plan_id uuid NOT NULL REFERENCES onboarding_plans(id) ON DELETE CASCADE, title text NOT NULL, description text,
  responsible text NOT NULL, phase text NOT NULL, due_date timestamp(3), completed boolean NOT NULL DEFAULT false,
  completed_at timestamp(3), completed_by_id uuid, "order" integer NOT NULL DEFAULT 0,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at timestamp(3) NOT NULL);
CREATE TABLE onboarding_check_ins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  plan_id uuid NOT NULL REFERENCES onboarding_plans(id) ON DELETE CASCADE);
${RLS_TABLES.map(
  (t) =>
    `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY; ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;
     CREATE POLICY tenant ON ${t} USING (false);`,
).join('\n')}
DO $r$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN NOBYPASSRLS;
  END IF;
END $r$;
GRANT ALL ON ALL TABLES IN SCHEMA public TO app_user;
`;

const NOW = "(now() AT TIME ZONE 'UTC')";

function freshDb(name: string, seed: string): string {
  sql('postgres', `CREATE DATABASE ${name}`);
  const f = join(dir, `${name}-fixture.sql`);
  writeFileSync(f, `${DDL}\n${seed}`);
  const r = psql(name, ['-q', '-f', f]);
  if (r.code !== 0) throw new Error(`fixture for ${name} failed: ${r.out}`);
  return name;
}

beforeAll(async () => {
  if (!ENABLED) return;
  dir = mkdtempSync(join(tmpdir(), 'backfill-pg-'));
  port = await freePort();
  const init = spawnSync(
    join(PG_BIN, 'initdb'),
    ['-D', join(dir, 'data'), '-U', 'postgres', '--auth=trust', '-E', 'UTF8'],
    {
      encoding: 'utf8',
      env: childEnv(),
    },
  );
  if (init.status !== 0) throw new Error(`initdb failed: ${init.stderr}`);
  const start = spawnSync(
    join(PG_BIN, 'pg_ctl'),
    [
      '-D',
      join(dir, 'data'),
      '-l',
      join(dir, 'pg.log'),
      '-w',
      '-o',
      `-p ${port} -c listen_addresses=127.0.0.1 -c unix_socket_directories='' -c timezone=UTC`,
      'start',
    ],
    { encoding: 'utf8', env: childEnv() },
  );
  if (start.status !== 0) {
    const log = existsSync(join(dir, 'pg.log')) ? readFileSync(join(dir, 'pg.log'), 'utf8') : '';
    throw new Error(`pg_ctl start failed: ${start.stderr}\n${log}`);
  }
}, 60_000);

afterAll(() => {
  if (!ENABLED || dir === '') return;
  spawnSync(join(PG_BIN, 'pg_ctl'), ['-D', join(dir, 'data'), '-m', 'immediate', 'stop'], { env: childEnv() });
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------------
// #288 — roles and grants for role-less orgs
// ---------------------------------------------------------------------------------------------------
suite('#288 roles backfill against a real cluster', () => {
  const TABLES = ['organizations', 'roles', 'permissions', 'role_permissions', 'user_roles'];
  const specGrants = ROLE_GRANTS.roles.reduce((n, r) => n + r.grants.length, 0);
  const distinctPerms = new Set(ROLE_GRANTS.roles.flatMap((r) => r.grants.map((g) => `${g.module}.${g.action}`)));
  const [preModule, preAction] = [...distinctPerms][0].split('.');
  // One target (like production on 2026-10-01: INVU), one partial org, one soft-deleted role-less org,
  // and one permission already in the global catalog.
  const SEED = `
    INSERT INTO organizations (id, name, slug, updated_at, deleted_at) VALUES
      ('00000000-0000-0000-0000-0000000000a1', 'Target', 'target', ${NOW}, NULL),
      ('00000000-0000-0000-0000-0000000000a2', 'Partial', 'partial', ${NOW}, NULL),
      ('00000000-0000-0000-0000-0000000000a3', 'Deleted', 'deleted', ${NOW}, ${NOW});
    INSERT INTO roles (organization_id, name, slug, updated_at)
      VALUES ('00000000-0000-0000-0000-0000000000a2', 'Custom', 'custom', ${NOW});
    INSERT INTO permissions (module, action) VALUES ('${preModule}', '${preAction}');`;

  it('dry run -> apply -> dry run 0 -> apply 0 is a no-op -> stale total aborts and writes nothing', () => {
    const db = freshDb('bf288', SEED);
    const before = runScript(db, SCRIPT[288]);
    expect(before.code).toBe(0);
    expect(resultRow(before.out, 'expected_orgs').expected_orgs).toBe(1);
    expect(before.out).toContain('DRY RUN ONLY');

    const apply = runScript(db, SCRIPT[288], { apply: 'true', expected_orgs: '1' });
    expect(apply.code, apply.out).toBe(0);
    expect(sql(db, `SELECT count(*) FROM roles WHERE organization_id = '00000000-0000-0000-0000-0000000000a1'`)).toBe(
      String(ROLE_GRANTS.roles.length),
    );
    expect(
      sql(
        db,
        `SELECT count(*) FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
         WHERE r.organization_id = '00000000-0000-0000-0000-0000000000a1'`,
      ),
    ).toBe(String(specGrants));
    expect(sql(db, 'SELECT count(*) FROM permissions')).toBe(String(distinctPerms.size));
    // Untouched: the partial org keeps its single custom role, the deleted org stays role-less, no user_roles.
    expect(sql(db, `SELECT count(*) FROM roles WHERE organization_id = '00000000-0000-0000-0000-0000000000a2'`)).toBe(
      '1',
    );
    expect(sql(db, `SELECT count(*) FROM roles WHERE organization_id = '00000000-0000-0000-0000-0000000000a3'`)).toBe(
      '0',
    );
    expect(sql(db, 'SELECT count(*) FROM user_roles')).toBe('0');
    // TimeZone pinned: created_at is the UTC instant even though the client's PGTZ is America/Bogota.
    expect(
      sql(
        db,
        `SELECT bool_and(abs(extract(epoch FROM created_at - ${NOW})) < 120 AND created_at = updated_at) FROM roles WHERE organization_id = '00000000-0000-0000-0000-0000000000a1'`,
      ),
    ).toBe('t');

    const after = snapshot(db, TABLES);
    const rerunDry = runScript(db, SCRIPT[288]);
    expect(rerunDry.code).toBe(0);
    expect(resultRow(rerunDry.out, 'expected_orgs').expected_orgs).toBe(0);

    const noop = runScript(db, SCRIPT[288], { apply: 'true', expected_orgs: '0' });
    expect(noop.code, noop.out).toBe(0);
    expect(snapshot(db, TABLES)).toBe(after);

    const stale = runScript(db, SCRIPT[288], { apply: 'true', expected_orgs: '1' });
    expect(stale.code).toBe(3);
    expect(stale.out).toMatch(/0 organizations now have no roles, dry run said 1/);
    expect(snapshot(db, TABLES)).toBe(after);
  });

  it('the COMMITTED connector file (expected_orgs=1, already applied in production) applies once, then aborts with no write', () => {
    expect(CONNECTOR_INPUTS['288-org-roles-and-grants']).toEqual({ expected_orgs: '1' });
    const db = freshDb('bf288c', SEED);
    const file = join(BACKFILLS, 'apply-via-connector/288-org-roles-and-grants.sql');
    const first = psql(db, ['-f', file]);
    expect(first.code, first.out).toBe(0);
    const after = snapshot(db, TABLES);
    const second = psql(db, ['-f', file]);
    expect(second.code).toBe(3);
    expect(second.out).toMatch(/0 organizations now have no roles, dry run said 1/);
    expect(snapshot(db, TABLES)).toBe(after);
  });

  it('refuses a role without BYPASSRLS and an invalid apply flag, writing nothing', () => {
    const db = freshDb('bf288r', SEED);
    const before = snapshot(db, TABLES);
    const noBypass = runScript(db, SCRIPT[288], { apply: 'true', expected_orgs: '1' }, 'app_user');
    expect(noBypass.code).toBe(3);
    expect(noBypass.out).toMatch(/lacks BYPASSRLS/);
    const bad = runScript(db, SCRIPT[288], { apply: 'yes', expected_orgs: '1' });
    expect(bad.code).toBe(3);
    expect(bad.out).toMatch(/must be exactly true or false/);
    const missing = runScript(db, SCRIPT[288], { apply: 'true' });
    expect(missing.code).toBe(3);
    expect(snapshot(db, TABLES)).toBe(before);
  });
});

// ---------------------------------------------------------------------------------------------------
// #319 — onboarding default tasks
// ---------------------------------------------------------------------------------------------------
suite('#319 onboarding backfill against a real cluster', () => {
  const TABLES = ['onboarding_plans', 'onboarding_tasks', 'onboarding_check_ins'];
  const O = '00000000-0000-0000-0000-0000000000b1';
  const P_EMPTY = '00000000-0000-0000-0000-00000000c001'; // active, in window, no tasks -> 12 defaults
  const P_PAST = '00000000-0000-0000-0000-00000000c002'; // active, past day 90, no tasks -> only with flag
  const P_TASKS = '00000000-0000-0000-0000-00000000c003'; // active, in window, has tasks
  const P_DONE = '00000000-0000-0000-0000-00000000c004'; // completed, no tasks -> never touched
  const P_PAST_T = '00000000-0000-0000-0000-00000000c005'; // active, past day 90, one undated task
  const SEED = `
    INSERT INTO organizations (id, name, slug, updated_at) VALUES ('${O}', 'Org', 'org', ${NOW});
    INSERT INTO onboarding_plans (id, organization_id, start_date, status) VALUES
      ('${P_EMPTY}',  '${O}', date_trunc('day', ${NOW}) - interval '10 days',  'active'),
      ('${P_PAST}',   '${O}', date_trunc('day', ${NOW}) - interval '200 days', 'active'),
      ('${P_TASKS}',  '${O}', date_trunc('day', ${NOW}) - interval '5 days',   'active'),
      ('${P_DONE}',   '${O}', date_trunc('day', ${NOW}) - interval '5 days',   'completed'),
      ('${P_PAST_T}', '${O}', date_trunc('day', ${NOW}) - interval '150 days', 'active');
    INSERT INTO onboarding_tasks (id, organization_id, plan_id, title, responsible, phase, due_date, updated_at) VALUES
      ('00000000-0000-0000-0000-00000000d001', '${O}', '${P_TASKS}', 'Presentación con el equipo', 'manager', 'day1_30', NULL, ${NOW}),
      ('00000000-0000-0000-0000-00000000d002', '${O}', '${P_TASKS}', 'Tarea propia', 'hr', 'day31_60', NULL, ${NOW}),
      ('00000000-0000-0000-0000-00000000d003', '${O}', '${P_TASKS}', 'Tarea propia 2', 'hr', 'otra', NULL, ${NOW}),
      ('00000000-0000-0000-0000-00000000d004', '${O}', '${P_TASKS}', 'Revisión de objetivos de 60 días', 'manager', 'day1_30', NULL, ${NOW}),
      ('00000000-0000-0000-0000-00000000d005', '${O}', '${P_TASKS}', 'Ya fechada', 'hr', 'day1_30', '2030-01-01', ${NOW}),
      ('00000000-0000-0000-0000-00000000d006', '${O}', '${P_PAST_T}', 'Tarea vieja', 'hr', 'day1_30', NULL, ${NOW});`;
  const TOTALS =
    'expected_empty_plans_default|expected_undated_tasks_default|expected_empty_plans_with_past|expected_undated_tasks_with_past';

  it('dry run -> apply -> dry run 0 -> apply 0 is a no-op -> stale totals abort and write nothing', () => {
    const db = freshDb('bf319', SEED);
    const dry = runScript(db, SCRIPT[319]);
    expect(dry.code, dry.out).toBe(0);
    expect(resultRow(dry.out, TOTALS)).toEqual({
      expected_empty_plans_default: 1,
      expected_undated_tasks_default: 3,
      expected_empty_plans_with_past: 2,
      expected_undated_tasks_with_past: 4,
    });

    const apply = runScript(db, SCRIPT[319], { apply: 'true', expected_empty_plans: '1', expected_undated_tasks: '3' });
    expect(apply.code, apply.out).toBe(0);
    // A: the empty in-window plan got the 12 defaults with code-identical dates and phases.
    expect(
      sql(
        db,
        `SELECT string_agg("order" || ':' || (due_date::date - p.start_date::date) || ':' || phase, ',' ORDER BY "order")
         FROM onboarding_tasks t JOIN onboarding_plans p ON p.id = t.plan_id WHERE p.id = '${P_EMPTY}'`,
      ),
    ).toBe(
      '0:-3:day1_30,1:-1:day1_30,2:0:day1_30,3:0:day1_30,4:2:day1_30,5:2:day1_30,6:5:day1_30,7:5:day1_30,' +
        '8:7:day1_30,9:30:day1_30,10:60:day31_60,11:90:day61_90',
    );
    // B: undated tasks dated by the rule; the unknown-phase custom task stays NULL; the dated one is untouched.
    expect(
      sql(
        db,
        `SELECT string_agg(right(t.id::text, 4) || ':' || coalesce((t.due_date::date - p.start_date::date)::text, 'null'), ',' ORDER BY t.id)
         FROM onboarding_tasks t JOIN onboarding_plans p ON p.id = t.plan_id WHERE p.id = '${P_TASKS}'`,
      ),
    ).toMatch(/^d001:5,d002:60,d003:null,d004:30,d005:\d+$/);
    expect(sql(db, `SELECT due_date FROM onboarding_tasks WHERE id = '00000000-0000-0000-0000-00000000d005'`)).toBe(
      '2030-01-01 00:00:00',
    );
    // Excluded by default: past-day-90 plans and completed plans.
    expect(sql(db, `SELECT count(*) FROM onboarding_tasks WHERE plan_id IN ('${P_PAST}', '${P_DONE}')`)).toBe('0');
    expect(
      sql(db, `SELECT due_date IS NULL FROM onboarding_tasks WHERE id = '00000000-0000-0000-0000-00000000d006'`),
    ).toBe('t');

    const after = snapshot(db, TABLES);
    const rerunDry = runScript(db, SCRIPT[319]);
    expect(resultRow(rerunDry.out, TOTALS)).toEqual({
      expected_empty_plans_default: 0,
      expected_undated_tasks_default: 0,
      expected_empty_plans_with_past: 1,
      expected_undated_tasks_with_past: 1,
    });

    const noop = runScript(db, SCRIPT[319], { apply: 'true', expected_empty_plans: '0', expected_undated_tasks: '0' });
    expect(noop.code, noop.out).toBe(0);
    expect(snapshot(db, TABLES)).toBe(after);

    // The committed connector file inlines production's 0/0/false: on an already-applied database it is a no-op.
    const connector = psql(db, ['-f', join(BACKFILLS, 'apply-via-connector/319-onboarding-default-tasks.sql')]);
    expect(connector.code, connector.out).toBe(0);
    expect(snapshot(db, TABLES)).toBe(after);

    const stale = runScript(db, SCRIPT[319], { apply: 'true', expected_empty_plans: '1', expected_undated_tasks: '3' });
    expect(stale.code).toBe(3);
    expect(snapshot(db, TABLES)).toBe(after);
  });

  it('include_past_day90=true picks up the rest exactly once', () => {
    const db = freshDb('bf319p', SEED);
    const all = runScript(db, SCRIPT[319], {
      apply: 'true',
      include_past_day90: 'true',
      expected_empty_plans: '2',
      expected_undated_tasks: '4',
    });
    expect(all.code, all.out).toBe(0);
    expect(sql(db, `SELECT count(*) FROM onboarding_tasks WHERE plan_id = '${P_PAST}'`)).toBe('12');
    const after = snapshot(db, TABLES);
    const again = runScript(db, SCRIPT[319], {
      apply: 'true',
      include_past_day90: 'true',
      expected_empty_plans: '0',
      expected_undated_tasks: '0',
    });
    expect(again.code, again.out).toBe(0);
    expect(snapshot(db, TABLES)).toBe(after);
  });

  it('refuses invalid flags and a role without BYPASSRLS, writing nothing', () => {
    const db = freshDb('bf319r', SEED);
    const before = snapshot(db, TABLES);
    expect(runScript(db, SCRIPT[319], { apply: 'maybe' }).code).toBe(3);
    expect(runScript(db, SCRIPT[319], { include_past_day90: 'yes' }).code).toBe(3);
    const noBypass = runScript(
      db,
      SCRIPT[319],
      { apply: 'true', expected_empty_plans: '1', expected_undated_tasks: '3' },
      'app_user',
    );
    expect(noBypass.code).toBe(3);
    expect(noBypass.out).toMatch(/lacks BYPASSRLS/);
    expect(snapshot(db, TABLES)).toBe(before);
  });
});

// ---------------------------------------------------------------------------------------------------
// #320 — org structure defaults
// ---------------------------------------------------------------------------------------------------
suite('#320 org-structure backfill against a real cluster', () => {
  const TABLES = ['organizations', 'companies', 'business_units', 'teams', 'user_teams', 'user_business_units'];
  const SEED = `
    INSERT INTO organizations (id, name, slug, updated_at, deleted_at) VALUES
      ('00000000-0000-0000-0000-0000000000e1', 'Empty One', 'e1', ${NOW}, NULL),
      ('00000000-0000-0000-0000-0000000000e2', 'Empty Two', 'e2', ${NOW}, NULL),
      ('00000000-0000-0000-0000-0000000000e3', 'Complete', 'e3', ${NOW}, NULL),
      ('00000000-0000-0000-0000-0000000000e4', 'Partial', 'e4', ${NOW}, NULL),
      ('00000000-0000-0000-0000-0000000000e5', 'Deleted', 'e5', ${NOW}, ${NOW});
    INSERT INTO companies (id, organization_id, name, country, updated_at) VALUES
      ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000e3', 'Complete', 'CO', ${NOW}),
      ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000e4', 'Partial', 'CO', ${NOW});
    INSERT INTO business_units (id, organization_id, company_id, name, updated_at) VALUES
      ('00000000-0000-0000-0000-0000000001f3', '00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000f3', 'General', ${NOW});
    INSERT INTO teams (organization_id, business_unit_id, name, updated_at) VALUES
      ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000001f3', 'Equipo General', ${NOW});`;

  it('dry run -> apply -> dry run 0 -> apply 0 is a no-op -> stale total aborts and writes nothing', () => {
    const db = freshDb('bf320', SEED);
    const dry = runScript(db, SCRIPT[320]);
    expect(dry.code, dry.out).toBe(0);
    expect(resultRow(dry.out, 'expected_orgs').expected_orgs).toBe(2);

    const apply = runScript(db, SCRIPT[320], { apply: 'true', expected_orgs: '2' });
    expect(apply.code, apply.out).toBe(0);
    expect(
      sql(
        db,
        `SELECT string_agg(o.slug || ':' || c.name || '/' || c.country || '/' || b.name || '/' || t.name || '/' ||
                           (t.leader_id IS NULL) || '/' || (c.created_at = c.updated_at), ',' ORDER BY o.slug)
         FROM organizations o JOIN companies c ON c.organization_id = o.id
         JOIN business_units b ON b.company_id = c.id AND b.organization_id = o.id
         JOIN teams t ON t.business_unit_id = b.id AND t.organization_id = o.id
         WHERE o.slug IN ('e1', 'e2')`,
      ),
    ).toBe('e1:Empty One/CO/General/Equipo General/true/true,e2:Empty Two/CO/General/Equipo General/true/true');
    // created_at is the UTC instant even though the client's PGTZ is America/Bogota.
    expect(
      sql(
        db,
        `SELECT bool_and(abs(extract(epoch FROM created_at - ${NOW})) < 120) FROM companies WHERE organization_id IN ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2')`,
      ),
    ).toBe('t');
    // Untouched: the partial org (company only), the complete org, the deleted org.
    expect(
      sql(db, `SELECT count(*) FROM business_units WHERE organization_id = '00000000-0000-0000-0000-0000000000e4'`),
    ).toBe('0');
    expect(
      sql(
        db,
        `SELECT count(*) FROM companies WHERE organization_id IN ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000e5')`,
      ),
    ).toBe('1');

    const after = snapshot(db, TABLES);
    const rerunDry = runScript(db, SCRIPT[320]);
    expect(resultRow(rerunDry.out, 'expected_orgs').expected_orgs).toBe(0);
    const noop = runScript(db, SCRIPT[320], { apply: 'true', expected_orgs: '0' });
    expect(noop.code, noop.out).toBe(0);
    expect(snapshot(db, TABLES)).toBe(after);

    const stale = runScript(db, SCRIPT[320], { apply: 'true', expected_orgs: '2' });
    expect(stale.code).toBe(3);
    expect(stale.out).toMatch(/0 organizations now lack structure, dry run said 2/);
    expect(snapshot(db, TABLES)).toBe(after);
  });

  it('an excluded partial org with a unit but NO company does not roll back the valid targets (tier-1 review)', () => {
    const db = freshDb(
      'bf320p',
      `${SEED}
      INSERT INTO organizations (id, name, slug, updated_at, deleted_at) VALUES
        ('00000000-0000-0000-0000-0000000000e6', 'Unit Only', 'e6', ${NOW}, NULL);
      INSERT INTO business_units (id, organization_id, company_id, name, updated_at) VALUES
        ('00000000-0000-0000-0000-0000000001f6', '00000000-0000-0000-0000-0000000000e6', '00000000-0000-0000-0000-0000000000f3', 'Orphan', ${NOW});`,
    );
    const dry = runScript(db, SCRIPT[320]);
    expect(resultRow(dry.out, 'expected_orgs').expected_orgs).toBe(2);
    const apply = runScript(db, SCRIPT[320], { apply: 'true', expected_orgs: '2' });
    expect(apply.code, apply.out).toBe(0);
    expect(apply.out).toMatch(/1 non-deleted organizations with partial structure/);
    expect(
      sql(db, `SELECT count(*) FROM companies WHERE organization_id IN ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2')`),
    ).toBe('2');
    expect(sql(db, `SELECT count(*) FROM companies WHERE organization_id = '00000000-0000-0000-0000-0000000000e6'`)).toBe('0');
  });

  it('a connector render with the fixture total applies once, then aborts with no write', () => {
    const db = freshDb('bf320c', SEED);
    const file = join(dir, '320-connector.sql');
    writeFileSync(
      file,
      renderConnectorApply('320-org-structure-defaults', readFileSync(SCRIPT[320], 'utf8'), { expected_orgs: '2' }),
    );
    expect(psql(db, ['-f', file]).code).toBe(0);
    const after = snapshot(db, TABLES);
    expect(psql(db, ['-f', file]).code).toBe(3);
    expect(snapshot(db, TABLES)).toBe(after);
  });

  it('refuses invalid flags and a role without BYPASSRLS, writing nothing', () => {
    const db = freshDb('bf320r', SEED);
    const before = snapshot(db, TABLES);
    expect(runScript(db, SCRIPT[320], { apply: 'TRUE ' }).code).toBe(3);
    const noBypass = runScript(db, SCRIPT[320], { apply: 'true', expected_orgs: '2' }, 'app_user');
    expect(noBypass.code).toBe(3);
    expect(noBypass.out).toMatch(/lacks BYPASSRLS/);
    expect(snapshot(db, TABLES)).toBe(before);
  });
});
