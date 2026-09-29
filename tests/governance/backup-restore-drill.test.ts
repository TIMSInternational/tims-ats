/**
 * Failure-path contract of the production backup-restore drill.
 *
 *   scripts/backup-drill/run-drill.sh      0 verified · 1 ran and FOUND a problem · 2 COULD NOT RUN
 *   .github/workflows/backup-restore-drill.yml   fails loudly without its secret, never uploads the dump
 *
 * Same discipline as tests/db/schema-baseline-failure-paths.test.ts: a control whose did-not-run path is
 * untested is not a control (#38). Everything here runs OFFLINE against stub psql / pg_dump / pg_restore
 * binaries, so no test can reach a database. The real end-to-end proof against two supabase/postgres
 * containers is scripts/backup-drill/local-e2e.sh (needs Docker, so not part of vitest).
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();
const SCRIPT = join(REPO_ROOT, 'scripts/backup-drill/run-drill.sh');
const WORKFLOW = readFileSync(join(REPO_ROOT, '.github/workflows/backup-restore-drill.yml'), 'utf8');

const SRC_URL = 'postgresql://src:pw@127.0.0.1:5999/postgres';
const TGT_URL = 'postgresql://tgt:pw@127.0.0.1:5998/postgres';

let sandbox: string;

type Run = { code: number; out: string };

function exec(cmd: string, args: string[], env: Record<string, string | undefined>): Run {
  try {
    const out = execFileSync(cmd, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      // Inherit nothing database-related from the developer's shell.
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', NODE_ENV: 'test', ...env },
    });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

// ── Stub binaries ─────────────────────────────────────────────────────────────────────────────────
// psql answers the drill's queries from fixture files. The side (source/target) is read from the
// connection string's user name. It serves both one-shot `-c` queries and the stdin-driven snapshot
// session, which is the part of the script most worth exercising offline.
const PSQL_STUB = String.raw`#!/bin/sh
[ "$1" = "--version" ] && { echo "psql (PostgreSQL) 17.6"; exit 0; }
side=tgt; queries=""; mode=stdin
while [ $# -gt 0 ]; do
  case "$1" in
    -d) case "$2" in *//src:*) side=src ;; esac; shift ;;
    -c) mode=cmd; queries="$queries $2"; shift ;;
  esac
  shift
done
# Every connection is logged (side, plus any libpq env var that could redirect it) so tests can
# assert that a refused target was never contacted, and never sent a destructive statement.
echo "connect $side PGHOSTADDR=$PGHOSTADDR PGSERVICE=$PGSERVICE" >> "$STUB_DIR/calls"
case "$queries" in *"DROP SCHEMA"*) echo "DESTRUCTIVE $side" >> "$STUB_DIR/calls" ;; esac
if [ "$side" = src ] && [ -n "$STUB_SRC_DOWN" ]; then
  echo 'psql: error: connection to server at "127.0.0.1", port 5999 failed: Connection refused' >&2
  exit 2
fi
answer() {
  case "$1" in
    *rolbypassrls*) echo "17|17.6|$STUB_BYPASS|$STUB_SRC_SYSID" ;;
    *"rolsuper::text"*) echo "true|17|0|$STUB_TGT_SYSID|$STUB_TGT_ADDR_OK" ;;
    *"SELECT 'COUNT'"*) cat "$STUB_DIR/$side.counts" ;;
    *"SELECT 'INV'"*) cat "$STUB_DIR/$side.inventory" ;;
    *"SELECT 'ROLE'"*) printf 'ROLE\tapp_tenant\n' ;;
    *pg_export_snapshot*) printf 'SNAPSHOT\t00000003-0000001B-1\n' ;;
  esac
}
# Each one-shot invocation carries at most one query the drill reads output from.
[ "$mode" = cmd ] && { answer "$queries"; exit 0; }
while IFS= read -r line; do
  case "$line" in
    '\q') exit 0 ;;
    '\echo '*) printf '%s\n' "$line" | cut -c7- ;;
    *) answer "$line" ;;
  esac
done
exit 0
`;

const PG_DUMP_STUB = String.raw`#!/bin/sh
[ "$1" = "--version" ] && { echo "pg_dump (PostgreSQL) 17.6"; exit 0; }
[ -n "$STUB_DUMP_FAIL" ] && { echo "pg_dump: error: query would be affected by row-level security policy for table \"candidates\"" >&2; exit 1; }
for a in "$@"; do case "$a" in --file=*) f=$(printf '%s' "$a" | cut -c8-); printf 'PGDMP stub dump\n' > "$f"; echo "$f" > "$STUB_DIR/dump-path" ;; esac; done
exit 0
`;

const PG_RESTORE_STUB = String.raw`#!/bin/sh
[ "$1" = "--version" ] && { echo "pg_restore (PostgreSQL) 17.6"; exit 0; }
if [ -n "$STUB_RESTORE_ERR" ]; then
  cat >&2 <<'EOF'
pg_restore: processing data for table "public.candidates"
pg_restore: from TOC entry 4242; 0 16500 TABLE DATA candidates postgres
pg_restore: error: could not execute query: ERROR:  duplicate key value violates unique constraint "candidates_email_key"
DETAIL:  Key (email)=(leaked-person@example.test) already exists.
Command was: COPY public.candidates (id, email) FROM stdin;
pg_restore: error: COPY failed for table "candidates": ERROR:  invalid input syntax for type uuid: "leaked-value-123"
pg_restore: from TOC entry 4243; 0 16501 TABLE DATA public audit_logs postgres
pg_restore: error: could not execute query: ERROR:  invalid input syntax for type uuid: "alice@example.test"suffix"
pg_restore: error: COPY failed for table "audit_logs": ERROR:  invalid input syntax for type uuid: "alice@example.test"suffix"
pg_restore: warning: errors ignored on restore: 4
EOF
  exit 1
fi
exit 0
`;

const COUNTS = 'COUNT\tpublic.candidates\t250\nCOUNT\tpublic.organizations\t3\nCOUNT\tauth.users\t1\n';
const INVENTORY =
  'INV\tRELATION public.candidates kind=r rls=true force_rls=true\n' +
  'INV\tPOLICY public.candidates tenant_isolation cmd=* permissive=true roles=app_tenant using=(x) check=(x)\n';

function makeStubs(name: string, target: { counts?: string; inventory?: string } = {}): {
  bin: string;
  tmp: string;
} {
  const bin = join(sandbox, name);
  const tmp = join(bin, 'tmp');
  mkdirSync(tmp, { recursive: true });
  for (const [file, body] of [
    ['psql', PSQL_STUB],
    ['pg_dump', PG_DUMP_STUB],
    ['pg_restore', PG_RESTORE_STUB],
  ] as const) {
    writeFileSync(join(bin, file), body);
    chmodSync(join(bin, file), 0o755);
  }
  writeFileSync(join(bin, 'src.counts'), COUNTS);
  writeFileSync(join(bin, 'src.inventory'), INVENTORY);
  writeFileSync(join(bin, 'tgt.counts'), target.counts ?? COUNTS);
  writeFileSync(join(bin, 'tgt.inventory'), target.inventory ?? INVENTORY);
  return { bin, tmp };
}

function drill(
  stubs: { bin: string; tmp: string },
  env: Record<string, string | undefined> = {},
): Run & { summary: string } {
  const summaryFile = join(stubs.bin, 'summary.md');
  writeFileSync(summaryFile, '');
  const r = exec('bash', [SCRIPT], {
    DRILL_SOURCE_URL: SRC_URL,
    DRILL_TARGET_URL: TGT_URL,
    DRILL_SOURCE_SSLMODE: 'disable',
    DRILL_PG_BIN: stubs.bin,
    STUB_DIR: stubs.bin,
    STUB_BYPASS: 'true',
    STUB_SRC_SYSID: '7000000000000000001',
    STUB_TGT_SYSID: '7000000000000000002',
    STUB_TGT_ADDR_OK: 'true',
    TMPDIR: stubs.tmp,
    GITHUB_STEP_SUMMARY: summaryFile,
    ...env,
  });
  return { ...r, summary: readFileSync(summaryFile, 'utf8') };
}

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'backup-drill-test-'));
});
afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('run-drill.sh — a clean drill is verified (positive control for every failure below)', () => {
  it('exits 0 when counts and inventory match, reports only aggregates, and deletes the dump', () => {
    const stubs = makeStubs('clean');
    const r = drill(stubs);
    expect(r.out).toMatch(/DRILL VERIFIED/);
    expect(r.code).toBe(0);
    expect(r.summary).toMatch(/Backup-restore drill VERIFIED/);
    expect(r.summary).toMatch(/Measured RTO/);
    expect(r.summary).toMatch(/`public\.candidates` \| 250/);
    // The dump was written, then removed with its private work dir.
    expect(readFileSync(join(stubs.bin, 'dump-path'), 'utf8')).toMatch(/drill\.dump/);
    expect(readdirSync(stubs.tmp)).toEqual([]);
  });
});

describe('run-drill.sh — exit 2 means DID NOT RUN, never a pass', () => {
  it('exits 2 when the source URL (the workflow secret) is missing', () => {
    const r = drill(makeStubs('no-source'), { DRILL_SOURCE_URL: undefined });
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/DID NOT RUN/);
    expect(r.out).toMatch(/DRILL_SOURCE_URL is not set/);
    expect(r.summary).toMatch(/DID NOT RUN/);
  });

  it('exits 2 when the source cannot be reached', () => {
    const r = drill(makeStubs('unreachable'), { STUB_SRC_DOWN: '1' });
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/cannot connect to the source database/);
    expect(r.out).toMatch(/Connection refused/);
  });

  it('exits 2 when the source role lacks BYPASSRLS — RLS would silently shrink the backup', () => {
    const r = drill(makeStubs('no-bypass'), { STUB_BYPASS: 'false' });
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/lacks BYPASSRLS/);
  });

  it('exits 2 when pg_dump fails, and still leaves no work dir behind', () => {
    const stubs = makeStubs('dump-fails');
    const r = drill(stubs, { STUB_DUMP_FAIL: '1' });
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/pg_dump failed/);
    expect(readdirSync(stubs.tmp)).toEqual([]);
  });

  it('exits 2 rather than let the secret downgrade TLS via an sslmode in the URL', () => {
    const r = drill(makeStubs('sslmode-in-url'), { DRILL_SOURCE_URL: `${SRC_URL}?sslmode=disable` });
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/must not carry sslmode/);
  });

  it('exits 2 when the restore target is not on a loopback host — it is prepared destructively', () => {
    const r = drill(makeStubs('remote-target'), {
      DRILL_TARGET_URL: 'postgresql://tgt:pw@aws-1-us-west-2.pooler.supabase.com:5432/postgres',
    });
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/must be exactly postgresql:\/\/user:password@\{localhost/);
  });

  it('exits 2 when the source exposes fewer tables than DRILL_MIN_TABLES', () => {
    const r = drill(makeStubs('too-few'), { DRILL_MIN_TABLES: '100' });
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/fewer than DRILL_MIN_TABLES=100/);
  });
});

describe('run-drill.sh — the restore target must provably be the ephemeral local database', () => {
  const calls = (bin: string): string => {
    try {
      return readFileSync(join(bin, 'calls'), 'utf8');
    } catch {
      return '';
    }
  };

  for (const [label, url] of [
    ['?hostaddr= override', `${TGT_URL}?hostaddr=192.0.2.1`],
    ['?host= override', `${TGT_URL}?host=db.example.invalid`],
    ['?service= override', `${TGT_URL}?service=prod`],
    ['a comma host list', 'postgresql://tgt:pw@localhost,db.example.invalid:5998/postgres'],
    ['a keyword/value connstring', 'host=localhost hostaddr=192.0.2.1 dbname=postgres'],
  ] as const) {
    it(`exits 2 on ${label}, before connecting to anything`, () => {
      const stubs = makeStubs(`target-${label.replace(/\W+/g, '-')}`);
      const r = drill(stubs, { DRILL_TARGET_URL: url });
      expect(r.code).toBe(2);
      expect(r.out).toMatch(/no query parameters/);
      expect(calls(stubs.bin)).toBe('');
    });
  }

  it('clears libpq env vars that could redirect a URL naming no hostaddr/service of its own', () => {
    const stubs = makeStubs('env-override');
    const r = drill(stubs, { PGHOSTADDR: '192.0.2.1', PGSERVICE: 'prod' });
    expect(r.code).toBe(0);
    expect(calls(stubs.bin)).toMatch(/connect tgt/);
    expect(calls(stubs.bin)).not.toMatch(/192\.0\.2\.1|=prod/);
  });

  it('exits 2 when the target is the same cluster as the source, before any destructive statement', () => {
    const stubs = makeStubs('same-cluster');
    const r = drill(stubs, { STUB_TGT_SYSID: '7000000000000000001' });
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/SAME Postgres cluster/);
    expect(calls(stubs.bin)).not.toMatch(/DESTRUCTIVE/);
  });

  it('exits 2 when the source system_identifier cannot be read — identity unproven is not safe', () => {
    const r = drill(makeStubs('no-sysid'), { STUB_SRC_SYSID: '' });
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/could not read the source system_identifier/);
  });

  it('exits 2 when the target server address is neither loopback nor private', () => {
    const stubs = makeStubs('public-addr');
    const r = drill(stubs, { STUB_TGT_ADDR_OK: 'false' });
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/not loopback or private/);
    expect(calls(stubs.bin)).not.toMatch(/DESTRUCTIVE/);
  });

  it('the clean path DOES reach the destructive step (positive control for the assertions above)', () => {
    const stubs = makeStubs('reaches-drop');
    expect(drill(stubs).code).toBe(0);
    expect(calls(stubs.bin)).toMatch(/DESTRUCTIVE tgt/);
  });
});

describe('run-drill.sh — exit 1 means the drill RAN and the backup is not trustworthy', () => {
  it('exits 1 on a row-count mismatch and names the table with both counts', () => {
    const r = drill(makeStubs('count-mismatch', { counts: COUNTS.replace('\t250\n', '\t249\n') }));
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/row-count mismatch on 1 table/);
    expect(r.out).toMatch(/public\.candidates\t250\t249/);
  });

  it('exits 1 when a table is missing from the restored copy', () => {
    const r = drill(makeStubs('table-missing', { counts: COUNTS.replace('COUNT\tauth.users\t1\n', '') }));
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/auth\.users\t1\tMISSING/);
  });

  it('exits 1 when the schema inventory differs (e.g. a lost RLS policy)', () => {
    const r = drill(makeStubs('inventory', { inventory: INVENTORY.split('\n')[0] + '\n' }));
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/schema inventory differs/);
    expect(r.out).toMatch(/< POLICY public\.candidates tenant_isolation/);
  });

  it('exits 1 on restore errors outside the allow-list, printing NO message text at all', () => {
    const r = drill(makeStubs('restore-error'), { STUB_RESTORE_ERR: '1' });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/4 restore error\(s\)\*\* outside the allow-list/);
    // The failing objects are identified by TOC entry, with a condition from a closed set…
    expect(r.out).toMatch(/\[unique_violation\] TOC 4242: TABLE DATA candidates postgres/);
    expect(r.out).toMatch(/\[invalid_text_representation\] TOC 4243: TABLE DATA public audit_logs postgres/);
    // …and NOTHING from any message: not the values, not the embedded-quote value that defeated the
    // old sed redaction (`"alice@example.test"suffix"`), not even the message wording.
    for (const leaked of ['leaked-person', 'leaked-value-123', 'alice', 'example.test', 'suffix', 'invalid input syntax', 'duplicate key']) {
      expect(r.out).not.toContain(leaked);
      expect(r.summary).not.toContain(leaked);
    }
  });
});

// ── The workflow ──────────────────────────────────────────────────────────────────────────────────

/** The `run: |` body of the step with this exact name, de-indented. Null when absent. */
function stepRun(name: string): string | null {
  const lines = WORKFLOW.split('\n');
  const start = lines.findIndex((l) => l.trim() === `- name: ${name}`);
  if (start === -1) return null;
  const runIdx = lines.findIndex((l, i) => i > start && /^\s+run: \|\s*$/.test(l));
  if (runIdx === -1) return null;
  const indent = lines[runIdx].match(/^(\s*)/)![1].length;
  const body: string[] = [];
  for (let i = runIdx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() !== '' && l.match(/^(\s*)/)![1].length <= indent) break;
    body.push(l.slice(indent + 2));
  }
  return body.join('\n');
}

describe('run-drill.sh inventory — definitions, not just names', () => {
  const src = readFileSync(SCRIPT, 'utf8');
  it('compares full function definitions and trigger enabled state', () => {
    // Behaviourally proven against real Postgres by local-e2e.sh scenarios 6 (tampered function body)
    // and 7 (disabled trigger), which both exit 0 without these two terms. Pinned here so a refactor
    // cannot quietly drop them in a run that has no Docker.
    expect(src).toMatch(/md5\(CASE WHEN p\.prokind IN \('f', 'p', 'w'\) THEN pg_get_functiondef\(p\.oid\)/);
    expect(src).toMatch(/' secdef=' \|\| p\.prosecdef/);
    expect(src).toMatch(/' enabled=' \|\| tg\.tgenabled::text/);
  });
});

describe('backup-restore-drill.yml', () => {
  const failFast = stepRun('Fail fast if the credential is absent');

  it('found the fail-fast step (non-vacuity for the two tests below)', () => {
    expect(failFast).not.toBeNull();
    expect(failFast).toMatch(/PROD_BACKUP_DRILL_URL/);
  });

  it('fails loudly with ::error when PROD_BACKUP_DRILL_URL is missing', () => {
    const summary = join(sandbox, 'wf-summary.md');
    writeFileSync(summary, '');
    const r = exec('bash', ['-c', failFast!], { PROD_BACKUP_DRILL_URL: '', GITHUB_STEP_SUMMARY: summary });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/::error title=Backup-restore drill did not run::/);
    expect(readFileSync(summary, 'utf8')).toMatch(/DID NOT RUN/);
  });

  it('passes the fail-fast step when the secret is present (positive control)', () => {
    const r = exec('bash', ['-c', failFast!], {
      PROD_BACKUP_DRILL_URL: 'postgresql://x@example.invalid/db',
      GITHUB_STEP_SUMMARY: join(sandbox, 'wf-summary2.md'),
    });
    expect(r.code).toBe(0);
  });

  it('treats drill exit 2 as a failure, never a pass', () => {
    const runStep = stepRun('Run the drill');
    expect(runStep).not.toBeNull();
    expect(runStep).toMatch(/2\) echo "::error title=Backup-restore drill DID NOT RUN::/);
    expect(runStep).toMatch(/^set \+e$/m);
    for (const code of ['0', '1', '2', '*'])
      expect(runStep).toMatch(new RegExp(`^\\s+${code.replace('*', '\\*')}\\) `, 'm'));
  });

  it('never uploads an artifact — the dump is production PII', () => {
    // Matches a `uses:` line, not the workflow comment explaining why the step is absent.
    expect(WORKFLOW).not.toMatch(/uses:\s*actions\/(upload-artifact|cache)/);
    expect(WORKFLOW).toMatch(/uses: actions\/checkout/); // the pattern does match real `uses:` lines
  });

  it('never sets the test-only damage hook', () => {
    expect(WORKFLOW).not.toMatch(/DRILL_TEST_POST_RESTORE_SQL/);
  });

  it('verifies TLS with the committed Supabase CA, and never downgrades it', () => {
    expect(WORKFLOW).toMatch(/DRILL_SOURCE_SSLMODE: verify-full/);
    expect(WORKFLOW).toMatch(/DRILL_SOURCE_SSLROOTCERT: scripts\/parity\/supabase-root-ca\.pem/);
    expect(readFileSync(join(REPO_ROOT, 'scripts/parity/supabase-root-ca.pem'), 'utf8')).toMatch(
      /BEGIN CERTIFICATE/,
    );
  });

  it('pins the restore target to an exact supabase/postgres 17.6 tag, the same one the local e2e uses', () => {
    const tag = WORKFLOW.match(/image: supabase\/postgres:(\S+)/)?.[1];
    expect(tag).toMatch(/^17\.6\.\d+\.\d+$/);
    const e2e = readFileSync(join(REPO_ROOT, 'scripts/backup-drill/local-e2e.sh'), 'utf8');
    expect(e2e).toContain(`supabase/postgres:${tag}`);
  });
});
