/**
 * WP-12 PR-2 — onboarding hire hand-off columns (findings hiring-team-ideal-75,
 * hiring-team-journeys-27, hiring-team-journeys-28).
 *
 * This PR is the schema enabler only: it adds four nullable columns that later PRs consume
 * (onboarding_plans.manager_id / first_day_info / welcome_sent_at, onboarding_tasks.resource_url).
 * The DDL is applied by hand by the owner BEFORE the PR merges, so it must be additive,
 * idempotent and re-runnable, and it must ship a rollback.
 *
 * These tests read the committed SQL and the generated Prisma DMMF; they never touch a database.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@tims/db';

const REPO_ROOT = join(__dirname, '..', '..');
const MIGRATION = join(REPO_ROOT, 'packages/db/prisma/migrations/20261102120000_onboarding_hire_handoff/migration.sql');
const ROLLBACK = join(REPO_ROOT, 'packages/db/prisma/manual/2026-11-02-onboarding-hire-handoff.ROLLBACK.sql');
const ONBOARDING_SCHEMA = join(REPO_ROOT, 'packages/db/prisma/schema/onboarding.prisma');
const USER_SCHEMA = join(REPO_ROOT, 'packages/db/prisma/schema/user.prisma');
/**
 * The production-schema baseline. The Playwright E2E stack (scripts/e2e/up.sh) loads THIS file as
 * its schema, never `prisma db push`, so a Prisma column missing here breaks every `create()` on
 * the model there (Prisma's INSERT ... RETURNING names every scalar column).
 */
const BASELINE = join(REPO_ROOT, 'packages/db/baseline/prod-public-schema.sql');

/** The exact column set this PR adds, per table. Pinned: adding or dropping one must fail. */
const EXPECTED_COLUMNS: Record<string, string[]> = {
  onboarding_plans: ['manager_id', 'first_day_info', 'welcome_sent_at'],
  onboarding_tasks: ['resource_url'],
};

function readSql(path: string): string {
  if (!existsSync(path)) {
    throw new Error(`expected SQL file is missing: ${path.slice(REPO_ROOT.length + 1)}`);
  }
  return readFileSync(path, 'utf8');
}

/** Strip `--` line comments so prose in the header can never satisfy or trip a scan. */
function stripComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

function modelBlock(schema: string, model: string): string {
  const match = new RegExp(`model\\s+${model}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(schema);
  if (!match) throw new Error(`model ${model} not found`);
  return match[1];
}

function field(model: string, name: string) {
  const m = Prisma.dmmf.datamodel.models.find((x) => x.name === model);
  expect(m, `model ${model}`).toBeDefined();
  return m!.fields.find((f) => f.name === name);
}

describe('migration 20261102120000_onboarding_hire_handoff', () => {
  it('(1) adds exactly the pinned columns, every ADD COLUMN guarded by IF NOT EXISTS', () => {
    const sql = stripComments(readSql(MIGRATION));

    const addColumns = [...sql.matchAll(/ADD\s+COLUMN\s+(IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/gi)];
    expect(addColumns.length).toBe(4);
    for (const m of addColumns) {
      expect(m[1], `ADD COLUMN ${m[2]} lacks IF NOT EXISTS`).toBeTruthy();
    }

    // Per-table pin: walk each ALTER TABLE statement and collect the columns it adds.
    const added: Record<string, string[]> = {};
    for (const stmt of sql.matchAll(/ALTER\s+TABLE\s+"?(\w+)"?([^;]*);/gi)) {
      const cols = [...stmt[2].matchAll(/ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/gi)].map((c) => c[1]);
      if (cols.length) added[stmt[1]] = [...(added[stmt[1]] ?? []), ...cols];
    }
    expect(added).toEqual(EXPECTED_COLUMNS);
  });

  it('(1b) types the new columns as the plan specifies', () => {
    const sql = stripComments(readSql(MIGRATION));
    expect(sql).toMatch(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+"manager_id"\s+UUID\b/i);
    expect(sql).toMatch(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+"first_day_info"\s+JSONB\b/i);
    expect(sql).toMatch(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+"welcome_sent_at"\s+TIMESTAMP\(3\)/i);
    expect(sql).toMatch(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+"resource_url"\s+VARCHAR\(2048\)/i);
  });

  it('(2) guards the manager FK with a pg_constraint check and uses ON DELETE SET NULL', () => {
    const sql = stripComments(readSql(MIGRATION));
    const guarded =
      /IF\s+NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+pg_constraint\s+WHERE\s+conname\s*=\s*'onboarding_plans_manager_id_fkey'\s*\)\s*THEN\s+ALTER\s+TABLE\s+"onboarding_plans"\s+ADD\s+CONSTRAINT\s+"onboarding_plans_manager_id_fkey"\s+FOREIGN\s+KEY\s*\(\s*"manager_id"\s*\)\s+REFERENCES\s+"users"\s*\(\s*"id"\s*\)\s+ON\s+DELETE\s+SET\s+NULL/i;
    expect(sql).toMatch(guarded);

    // Every ADD CONSTRAINT in the file must sit inside that guard (no unguarded duplicate).
    const addConstraints = sql.match(/ADD\s+CONSTRAINT/gi) ?? [];
    expect(addConstraints.length).toBe(1);
  });

  it('(3) is purely additive: no DROP, no NOT NULL, no UPDATE/DELETE/TRUNCATE (whole file)', () => {
    const sql = stripComments(readSql(MIGRATION));
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bNOT\s+NULL\b/i);
    expect(sql).not.toMatch(/\bUPDATE\s+"?\w+"?\s+SET\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(sql).not.toMatch(/\bGRANT\b|\bREVOKE\b|\bPOLICY\b/i);
  });

  it('(5) creates the manager_id index idempotently', () => {
    const sql = stripComments(readSql(MIGRATION));
    expect(sql).toMatch(
      /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+"onboarding_plans_manager_id_idx"\s+ON\s+"onboarding_plans"\s*\(\s*"manager_id"\s*\)/i,
    );
    const creates = sql.match(/CREATE\s+(UNIQUE\s+)?INDEX/gi) ?? [];
    expect(creates.length).toBe(1);
  });

  it('touches only onboarding_plans and onboarding_tasks (pinned table set)', () => {
    const sql = stripComments(readSql(MIGRATION));
    const tables = new Set([...sql.matchAll(/\b(?:ALTER\s+TABLE|ON)\s+"(\w+)"\s*[(\s]/gi)].map((m) => m[1]));
    expect([...tables].sort()).toEqual(['onboarding_plans', 'onboarding_tasks']);
  });
});

describe('rollback SQL for the onboarding hand-off columns', () => {
  it('drops exactly what the migration adds, each statement IF EXISTS, and never a table', () => {
    const sql = stripComments(readSql(ROLLBACK));
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).toMatch(/DROP\s+INDEX\s+IF\s+EXISTS\s+"onboarding_plans_manager_id_idx"/i);
    expect(sql).toMatch(/DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+"onboarding_plans_manager_id_fkey"/i);
    const dropped = [...sql.matchAll(/DROP\s+COLUMN\s+(IF\s+EXISTS\s+)?"?(\w+)"?/gi)];
    for (const m of dropped) expect(m[1], `DROP COLUMN ${m[2]} lacks IF EXISTS`).toBeTruthy();
    expect(dropped.map((m) => m[2]).sort()).toEqual([
      'first_day_info',
      'manager_id',
      'resource_url',
      'welcome_sent_at',
    ]);
  });
});

describe('(4) Prisma schema maps the new fields to exactly these snake_case columns', () => {
  it('OnboardingPlan.managerId -> manager_id, nullable UUID', () => {
    const f = field('OnboardingPlan', 'managerId');
    expect(f, 'OnboardingPlan.managerId').toBeDefined();
    expect(f!.dbName).toBe('manager_id');
    expect(f!.isRequired).toBe(false);
    expect(f!.nativeType?.[0]).toBe('Uuid');
  });

  it('OnboardingPlan.manager is a SetNull relation "OnboardingManager" with a User back-relation', () => {
    const rel = field('OnboardingPlan', 'manager');
    expect(rel, 'OnboardingPlan.manager').toBeDefined();
    expect(rel!.type).toBe('User');
    expect(rel!.relationName).toBe('OnboardingManager');
    expect(rel!.relationFromFields).toEqual(['managerId']);
    expect(rel!.relationOnDelete).toBe('SetNull');

    const user = Prisma.dmmf.datamodel.models.find((m) => m.name === 'User')!;
    const back = user.fields.filter((x) => x.relationName === 'OnboardingManager');
    expect(back).toHaveLength(1);
    expect(back[0].isList).toBe(true);
    expect(readFileSync(USER_SCHEMA, 'utf8')).toMatch(/@relation\("OnboardingManager"\)/);
  });

  it('OnboardingPlan.firstDayInfo -> first_day_info, nullable Json', () => {
    const f = field('OnboardingPlan', 'firstDayInfo');
    expect(f, 'OnboardingPlan.firstDayInfo').toBeDefined();
    expect(f!.dbName).toBe('first_day_info');
    expect(f!.type).toBe('Json');
    expect(f!.isRequired).toBe(false);
  });

  it('OnboardingPlan.welcomeSentAt -> welcome_sent_at, nullable DateTime', () => {
    const f = field('OnboardingPlan', 'welcomeSentAt');
    expect(f, 'OnboardingPlan.welcomeSentAt').toBeDefined();
    expect(f!.dbName).toBe('welcome_sent_at');
    expect(f!.type).toBe('DateTime');
    expect(f!.isRequired).toBe(false);
  });

  it('OnboardingTask.resourceUrl -> resource_url, nullable VarChar(2048)', () => {
    const f = field('OnboardingTask', 'resourceUrl');
    expect(f, 'OnboardingTask.resourceUrl').toBeDefined();
    expect(f!.dbName).toBe('resource_url');
    expect(f!.isRequired).toBe(false);
    expect(f!.nativeType?.[0]).toBe('VarChar');
    expect(f!.nativeType?.[1]).toEqual(['2048']);
  });

  it('(5) OnboardingPlan declares @@index([managerId])', () => {
    const block = modelBlock(readFileSync(ONBOARDING_SCHEMA, 'utf8'), 'OnboardingPlan');
    expect(block).toMatch(/@@index\(\[managerId\]\)/);
  });
});

/** Column name -> declared type, from the pg_dump CREATE TABLE block for `table` in the baseline. */
function baselineColumns(table: string): Map<string, string> {
  const baseline = readSql(BASELINE);
  const match = new RegExp(`CREATE TABLE public\\.${table} \\(\\n([\\s\\S]*?)\\n\\);`).exec(baseline);
  if (!match) throw new Error(`CREATE TABLE public.${table} not found in the baseline`);
  const cols = new Map<string, string>();
  for (const line of match[1].split('\n')) {
    const m = /^\s+"?(\w+)"?\s+(.*?),?$/.exec(line);
    if (m) cols.set(m[1], m[2]);
  }
  return cols;
}

describe('(6) the E2E/prod schema baseline mirrors the migration', () => {
  // Regression: PR #388 first added these fields to Prisma without mirroring them in the baseline.
  // The E2E stack loads the baseline, so offer.convertToEmployee's onboardingPlan.create() failed
  // with "column onboarding_plans.manager_id does not exist" and the hire journey never completed.
  for (const [model, table] of [
    ['OnboardingPlan', 'onboarding_plans'],
    ['OnboardingTask', 'onboarding_tasks'],
  ] as const) {
    it(`every scalar ${model} column exists in public.${table}`, () => {
      const cols = baselineColumns(table);
      const m = Prisma.dmmf.datamodel.models.find((x) => x.name === model);
      expect(m, `model ${model}`).toBeDefined();
      const missing = m!.fields
        .filter((f) => f.kind === 'scalar' || f.kind === 'enum')
        .map((f) => f.dbName ?? f.name)
        .filter((c) => !cols.has(c));
      expect(missing, 'columns Prisma will SELECT/RETURN that the baseline lacks').toEqual([]);
    });
  }

  it('types the four new baseline columns as the migration does, all nullable', () => {
    const plans = baselineColumns('onboarding_plans');
    const tasks = baselineColumns('onboarding_tasks');
    expect(plans.get('manager_id')).toBe('uuid');
    expect(plans.get('first_day_info')).toBe('jsonb');
    expect(plans.get('welcome_sent_at')).toBe('timestamp(3) without time zone');
    expect(tasks.get('resource_url')).toBe('character varying(2048)');
  });

  it('carries the manager_id index and the SET NULL foreign key', () => {
    const baseline = readSql(BASELINE);
    expect(baseline).toContain(
      'CREATE INDEX onboarding_plans_manager_id_idx ON public.onboarding_plans USING btree (manager_id);',
    );
    expect(baseline).toContain(
      'ADD CONSTRAINT onboarding_plans_manager_id_fkey FOREIGN KEY (manager_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;',
    );
  });
});
