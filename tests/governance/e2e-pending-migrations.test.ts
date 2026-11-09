import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ── The E2E stack must run the branch's code against the branch's schema ────────
//
// scripts/e2e/up.sh loads the PRODUCTION schema baseline. A release that ships a Prisma migration production has not
// applied yet (20261109100000_fit_v2_integrity added fit_scores.restricted_overall_score, which the pipeline board now
// selects) therefore ran its new TS against the old schema: every board query failed with Prisma P2022 and
// candidate-journey.spec.ts "recruiter sees the application in the pipeline" went red on the release while main stayed
// green. up.sh now applies every migration directory after packages/db/baseline/applied-through.txt.
//
// These checks keep that wiring honest: the step exists and runs inside load_schema, the marker names a real migration
// directory, and every pending migration is applied with ON_ERROR_STOP (fail loud, never skipped).

const ROOT = join(__dirname, '../..');
const UP = readFileSync(join(ROOT, 'scripts/e2e/up.sh'), 'utf8');
const MIGRATIONS = join(ROOT, 'packages/db/prisma/migrations');
const MARKER = join(ROOT, 'packages/db/baseline/applied-through.txt');

function body(name: string): string {
  const start = UP.indexOf(`${name}() {`);
  expect(start, `${name}() is defined in up.sh`).toBeGreaterThan(-1);
  const end = UP.indexOf('\n}\n', start);
  return UP.slice(start, end);
}

describe('E2E bring-up applies the migrations the production baseline does not have', () => {
  it('load_schema calls apply_pending_migrations after the baseline load', () => {
    const load = body('load_schema');
    expect(load.indexOf('apply_pending_migrations')).toBeGreaterThan(load.indexOf('baseline-local.sql'));
  });

  it('applies every pending migration with ON_ERROR_STOP and dies on failure', () => {
    const apply = body('apply_pending_migrations');
    expect(apply).toContain('applied-through.txt');
    expect(apply).toMatch(/psql "\$E2E_DB_URL" -v ON_ERROR_STOP=1 -q -f "\$dir\/migration\.sql"/);
    expect(apply).toContain('e2e_die "pending migration $name failed on the baseline"');
  });

  it('the marker names an existing migration directory', () => {
    const through = readFileSync(MARKER, 'utf8').trim();
    expect(existsSync(join(MIGRATIONS, through, 'migration.sql'))).toBe(true);
  });

  it('every migration newer than the marker is pending and has a migration.sql to apply', () => {
    const through = readFileSync(MARKER, 'utf8').trim();
    const pending = readdirSync(MIGRATIONS, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name > through)
      .map((d) => d.name);
    for (const name of pending) {
      expect(existsSync(join(MIGRATIONS, name, 'migration.sql')), name).toBe(true);
    }
    // This release ships one: it must be among the applied ones, or the journeys test the old schema again.
    expect(pending).toContain('20261109100000_fit_v2_integrity');
  });
});
