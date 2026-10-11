import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

// #124 / #328 — what the nightly live-DB workflow must keep doing. Textual on purpose: js-yaml is not a
// declared dependency of this package (same reasoning as ci-triggers.test.ts).

const ROOT = join(__dirname, '../..');
const WF = readFileSync(join(ROOT, '.github/workflows/nightly-db-controls.yml'), 'utf8');

/** The text of one top-level job: from `  <name>:` to the next job key or a column-0 line. */
function job(name: string): string {
  const lines = WF.split('\n');
  const start = lines.findIndex((l) => l === `  ${name}:`);
  expect(start, `job ${name} not found`).toBeGreaterThan(-1);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {2}[a-z][a-z0-9-]*:\s*$/.test(lines[i]) || /^\S/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

describe('nightly-db-controls — check 16 (schema drift) runs in CI and fails loud (#124)', () => {
  const live = job('live-checks');

  it('runs check 16 through the shared exit-code classifier', () => {
    expect(live).toMatch(/run_check 16 "schema drift vs baseline" bash scripts\/db\/schema-baseline\.sh check/);
  });

  it('treats exit 1 (drift), exit 2 (did not run) and any other exit as a FAILED job', () => {
    // Each non-zero branch of the case statement must set fail=1 ITSELF; only 0 may pass. Split per branch
    // so one branch's fail=1 can never satisfy another's assertion.
    const caseBody = /case \$rc in([\s\S]*?)\besac\b/.exec(live)?.[1];
    expect(caseBody, 'the exit-code case statement').toBeDefined();
    const branches = new Map(
      caseBody!
        .split(';;')
        .map((b) => b.trim())
        .filter(Boolean)
        .map((b) => [b.slice(0, b.indexOf(')')), b] as const),
    );
    expect([...branches.keys()]).toEqual(['0', '1', '2', '*']);
    expect(branches.get('0')).not.toMatch(/fail=1/);
    for (const code of ['1', '2', '*']) {
      expect(branches.get(code), `exit ${code} branch`).toMatch(/\bfail=1\s*$/);
    }
    expect(live).toMatch(/exit \$fail\s*$/m);
    expect(live).toMatch(/set \+e/);
  });

  it('installs pg_dump 17 and points check 16 at it', () => {
    expect(live).toContain('postgresql-client-17');
    expect(live).toMatch(/PG_DUMP: \/usr\/lib\/postgresql\/17\/bin\/pg_dump/);
  });

  it('refuses an absent credential and anything weaker than verify-full before running', () => {
    expect(live).toMatch(/if \[ -z "\$PROD_DIRECT_URL" \]; then[\s\S]*?exit 1/);
    expect(live).toContain('scripts/security/assert-verify-full.ts PROD_DIRECT_URL');
    expect(live).toMatch(/PGSSLMODE: verify-full/);
    expect(live).toMatch(/PGSSLROOTCERT: scripts\/parity\/supabase-root-ca\.pem/);
  });

  it('still runs on every schedule (the capture input can only divert a manual run)', () => {
    expect(live).toMatch(/if: \$\{\{ github\.event_name == 'schedule' \|\| !inputs\.capture_baseline \}\}/);
  });
});

describe('nightly-db-controls — baseline capture job (#328) hands back an artifact and never writes', () => {
  const cap = job('capture-baseline');

  it('runs only on a manual dispatch that asked for it, and refuses any ref but main', () => {
    expect(cap).toMatch(/if: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.capture_baseline \}\}/);
    expect(cap).toMatch(/if \[ "\$GITHUB_REF" != "refs\/heads\/main" \]; then[\s\S]*?exit 1/);
  });

  it('cannot push: read-only token, no persisted credentials, no git write commands', () => {
    expect(WF).toMatch(/^permissions:\n {2}contents: read$/m);
    expect(WF).not.toMatch(/contents: write/);
    expect(cap).toMatch(/persist-credentials: false/);
    expect(cap).not.toMatch(/git (push|commit|tag)\b/);
  });

  it('captures with the same TLS pinning and pg_dump as check 16, fails on exit 2, and round-trips', () => {
    expect(cap).toContain('postgresql-client-17');
    expect(cap).toMatch(/PG_DUMP: \/usr\/lib\/postgresql\/17\/bin\/pg_dump/);
    expect(cap).toContain('scripts/security/assert-verify-full.ts PROD_DIRECT_URL');
    expect(cap).toMatch(/PGSSLMODE: verify-full/);
    expect(cap).toMatch(/set -euo pipefail/);
    const capture = cap.indexOf('bash scripts/db/schema-baseline.sh capture');
    const regen = cap.indexOf('bash scripts/db/regenerate-flip-ddl.sh');
    const check = cap.indexOf('bash scripts/db/schema-baseline.sh check');
    expect(capture).toBeGreaterThan(-1);
    expect(regen).toBeGreaterThan(capture);
    expect(check).toBeGreaterThan(regen);
  });

  it('uploads the result as an artifact and errors if there is nothing to upload', () => {
    expect(cap).toMatch(/uses: actions\/upload-artifact@v4/);
    expect(cap).toMatch(/if-no-files-found: error/);
    expect(cap).toContain('schema-baseline-recapture.patch');
  });
});

describe('scripts/db/regenerate-flip-ddl.sh — parses its Regenerate lines, never executes them', () => {
  // The generator is replaced by a stub that records its argv (or fails), so these run without a baseline.
  const RECORD = "import { writeFileSync } from 'node:fs'; writeFileSync(new URL('./argv.json', import.meta.url), JSON.stringify(process.argv.slice(2)));\n";
  const FAIL = 'process.exit(1);\n';

  function runIn(
    files: Record<string, string>,
    stub = RECORD,
  ): { status: number | null; stderr: string; argv: string[] | null } {
    const dir = mkdtempSync(join(tmpdir(), 'flipddl-'));
    try {
      mkdirSync(join(dir, 'scripts/db'), { recursive: true });
      mkdirSync(join(dir, 'services/Tims.Platform/db/flip-ddl'), { recursive: true });
      copyFileSync(join(ROOT, 'scripts/db/regenerate-flip-ddl.sh'), join(dir, 'scripts/db/regenerate-flip-ddl.sh'));
      writeFileSync(join(dir, 'scripts/db/extract-table-ddl.mjs'), stub);
      for (const [name, body] of Object.entries(files)) {
        writeFileSync(join(dir, 'services/Tims.Platform/db/flip-ddl', name), body);
      }
      const r = spawnSync('bash', [join(dir, 'scripts/db/regenerate-flip-ddl.sh')], { encoding: 'utf8' });
      let argv: string[] | null = null;
      try {
        argv = JSON.parse(readFileSync(join(dir, 'scripts/db/argv.json'), 'utf8')) as string[];
      } catch {
        argv = null;
      }
      return { status: r.status, stderr: r.stderr, argv };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const header = (tail: string) => `-- GENERATED FILE\n-- Regenerate: node scripts/db/extract-table-ddl.mjs ${tail}\n`;

  it('positive control: a valid line calls the generator with --out <repo-relative file> and the tables', () => {
    const r = runIn({ 'surveys.sql': header('surveys survey_responses') });
    expect(r.status).toBe(0);
    expect(r.argv).toEqual(['--out', 'services/Tims.Platform/db/flip-ddl/surveys.sql', 'surveys', 'survey_responses']);
  });

  it('exits 2 when there are no flip-ddl files at all', () => {
    expect(runIn({}).status).toBe(2);
  });

  it('exits 2 on a file whose line 2 is not a Regenerate line', () => {
    const r = runIn({ 'x.sql': '-- GENERATED FILE\n-- something else\n' });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/not a '-- Regenerate:' line/);
    expect(r.argv).toBeNull();
  });

  it('exits 2 on a Regenerate line carrying anything but plain identifiers, without calling the generator', () => {
    for (const tail of ['surveys; touch pwned', 'surveys $(id)', 'Surveys', 'surveys  survey_responses', '']) {
      const r = runIn({ 'x.sql': header(tail) });
      expect(r.status, tail).toBe(2);
      expect(r.argv, tail).toBeNull();
    }
  });

  it('exits 2 when the generator fails', () => {
    const r = runIn({ 'x.sql': header('surveys') }, FAIL);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/extract-table-ddl\.mjs failed/);
  });
});

describe('nightly-db-controls — public-repo hardening (#328 review)', () => {
  const live = job('live-checks');
  const cap = job('capture-baseline');

  it('both jobs that read PROD_DIRECT_URL run in the main-only prod-db-controls environment', () => {
    for (const j of [live, cap]) {
      expect(j).toContain('secrets.PROD_DIRECT_URL');
      expect(j).toMatch(/^ {4}environment: prod-db-controls$/m);
    }
  });

  it('both jobs install dependencies without lifecycle scripts', () => {
    for (const j of [live, cap]) {
      expect(j).toMatch(/pnpm install --frozen-lockfile --ignore-scripts/);
      expect(j).not.toMatch(/pnpm install --frozen-lockfile\s*$/m);
    }
  });

  it('check 16 / capture print object names only in CI', () => {
    for (const j of [live, cap]) expect(j).toMatch(/SCHEMA_DRIFT_OBJECTS_ONLY: '1'/);
  });

  it('scans for credentials BEFORE uploading, keeps the artifact 1 day, and puts no verbatim text in the summary', () => {
    const scan = cap.indexOf('bash scripts/security/scan-for-credentials.sh "$RUNNER_TEMP/schema-baseline-recapture"');
    const upload = cap.indexOf('uses: actions/upload-artifact@v4');
    expect(scan).toBeGreaterThan(-1);
    expect(upload).toBeGreaterThan(scan);
    expect(cap).toMatch(/retention-days: 1$/m);
    expect(cap).not.toMatch(/cat "\$out\/[^"]*"[^\n]*\n[\s\S]*?GITHUB_STEP_SUMMARY/);
  });
});
