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

function calls(bin: string): string {
  try {
    return readFileSync(join(bin, 'calls'), 'utf8');
  } catch {
    return '';
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
tgt_public="$STUB_TGT_PUBLIC"; [ -n "$tgt_public" ] || tgt_public=0
answer() {
  case "$1" in
    *drill_meta.target_marker*)
      [ -n "$STUB_TGT_NO_MARKER" ] && { echo 'ERROR:  relation "drill_meta.target_marker" does not exist' >&2; exit 1; }
      echo "$STUB_TGT_MARKER" ;;
    *TARGET_ROWS*) echo "TARGET_ROWS|$STUB_TGT_ROWS" ;;
    *rolbypassrls*) echo "17|17.6|$STUB_BYPASS|$STUB_SRC_SYSID" ;;
    *"rolsuper::text"*) echo "true|17|$tgt_public|$STUB_TGT_SYSID|$STUB_TGT_ADDR_OK" ;;
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
    '\echo '*) printf '%s\n' "$line" | cut -c7-
      # Simulates the snapshot session dying right after exporting: the drill's next write to it
      # hits a closed pipe.
      [ -n "$STUB_SESSION_DIES" ] && [ "$line" = '\echo __SNAPSHOT_DONE__' ] && exit 3 ;;
    *) answer "$line" ;;
  esac
done
exit 0
`;

const PG_DUMP_STUB = String.raw`#!/bin/sh
[ "$1" = "--version" ] && { echo "pg_dump (PostgreSQL) 17.6"; exit 0; }
[ -n "$STUB_DUMP_FAIL" ] && { echo "pg_dump: error: query would be affected by row-level security policy for table \"candidates\"" >&2; exit 1; }
printf '%s\n' "$@" > "$STUB_DIR/dump-args"
for a in "$@"; do case "$a" in --file=*) f=$(printf '%s' "$a" | cut -c8-); printf 'PGDMP stub dump\n' > "$f"; echo "$f" > "$STUB_DIR/dump-path" ;; esac; done
exit 0
`;

const PG_RESTORE_STUB = String.raw`#!/bin/sh
[ "$1" = "--version" ] && { echo "pg_restore (PostgreSQL) 17.6"; exit 0; }
# Non-zero exit with no error lines at all: must never be read as benign.
[ -n "$STUB_RESTORE_RC_ONLY" ] && exit 1
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

function makeStubs(
  name: string,
  target: { counts?: string; inventory?: string } = {},
  source: { counts?: string } = {},
): {
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
  writeFileSync(join(bin, 'src.counts'), source.counts ?? COUNTS);
  writeFileSync(join(bin, 'src.inventory'), INVENTORY);
  writeFileSync(join(bin, 'tgt.counts'), target.counts ?? COUNTS);
  writeFileSync(join(bin, 'tgt.inventory'), target.inventory ?? INVENTORY);
  return { bin, tmp };
}

function drill(
  stubs: { bin: string; tmp: string },
  env: Record<string, string | undefined> = {},
  args: string[] = [],
): Run & { summary: string } {
  const summaryFile = join(stubs.bin, 'summary.md');
  writeFileSync(summaryFile, '');
  const r = exec('bash', [SCRIPT, ...args], {
    DRILL_SOURCE_URL: SRC_URL,
    DRILL_TARGET_URL: TGT_URL,
    DRILL_SOURCE_SSLMODE: 'disable',
    DRILL_PG_BIN: stubs.bin,
    STUB_DIR: stubs.bin,
    STUB_BYPASS: 'true',
    STUB_SRC_SYSID: '7000000000000000001',
    STUB_TGT_SYSID: '7000000000000000002',
    STUB_TGT_ADDR_OK: 'true',
    STUB_TGT_MARKER: 'run-1',
    STUB_TGT_ROWS: '0',
    DRILL_TARGET_MARKER: 'run-1',
    DRILL_VERIFY_SSLMODE: 'disable',
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

  it('exits 2 when DRILL_TARGET_MARKER is not set, before connecting to anything', () => {
    const stubs = makeStubs('no-marker-env');
    const r = drill(stubs, { DRILL_TARGET_MARKER: undefined });
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/DRILL_TARGET_MARKER is not set/);
    expect(calls(stubs.bin)).toBe('');
  });

  it('exits 2 when the target has no drill marker table — an empty-looking database is not enough', () => {
    const stubs = makeStubs('no-marker-table');
    const r = drill(stubs, { STUB_TGT_NO_MARKER: '1' });
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/has no drill_meta\.target_marker/);
    expect(calls(stubs.bin)).not.toMatch(/DESTRUCTIVE/);
  });

  it("exits 2 when the target's marker belongs to a different run", () => {
    const stubs = makeStubs('wrong-marker');
    const r = drill(stubs, { STUB_TGT_MARKER: 'run-0' });
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/marker does not match/);
    expect(calls(stubs.bin)).not.toMatch(/DESTRUCTIVE/);
  });

  it('exits 2 when public is empty but another selected schema holds rows (e.g. auth.users), dropping nothing', () => {
    const stubs = makeStubs('populated-auth');
    const r = drill(stubs, { STUB_TGT_ROWS: '1' });
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/already holds 1 row\(s\)/);
    expect(calls(stubs.bin)).not.toMatch(/DESTRUCTIVE/);
  });

  it('exits 2 if drill_meta (the marker schema) is ever selected for dumping and dropping', () => {
    const stubs = makeStubs('drill-meta-selected');
    const r = drill(stubs, { DRILL_SCHEMAS: 'public drill_meta' });
    expect(r.code).toBe(2);
    expect(calls(stubs.bin)).toBe('');
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

describe('run-drill.sh — an empty or wrong source can never verify green', () => {
  const ZERO = 'COUNT\tpublic.candidates\t0\nCOUNT\tpublic.organizations\t0\nCOUNT\tauth.users\t0\n';

  it('exits 2 when every table is empty — even though the restore would match "exactly"', () => {
    // Source and target both all-zero: before the row floor this exited 0 (mutation-checked).
    const stubs = makeStubs('all-zero', { counts: ZERO }, { counts: ZERO });
    const r = drill(stubs);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/holds 0 rows in total .* fewer than DRILL_MIN_ROWS=1/);
    expect(r.summary).toMatch(/DID NOT RUN/);
    expect(calls(stubs.bin)).not.toMatch(/DESTRUCTIVE/);
  });

  it('exits 2 when the total is below DRILL_MIN_ROWS', () => {
    const r = drill(makeStubs('min-rows'), { DRILL_MIN_ROWS: '1000' });
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/holds 254 rows in total .* fewer than DRILL_MIN_ROWS=1000/);
  });

  it('exits 2 when a sentinel table is empty (public.organizations) though other tables have rows', () => {
    const counts = COUNTS.replace('public.organizations\t3', 'public.organizations\t0');
    const r = drill(makeStubs('sentinel-empty', { counts }, { counts }));
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/public\.organizations is empty in the source/);
  });

  it('exits 2 when a sentinel table is absent (auth.users)', () => {
    const counts = COUNTS.replace('COUNT\tauth.users\t1\n', '');
    const r = drill(makeStubs('sentinel-absent', { counts }, { counts }));
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/auth\.users is absent in the source/);
  });

  it('skips a sentinel whose schema is not selected (DRILL_SCHEMAS=public)', () => {
    const counts = COUNTS.replace('COUNT\tauth.users\t1\n', '');
    const r = drill(makeStubs('sentinel-unselected', { counts }, { counts }), { DRILL_SCHEMAS: 'public' });
    expect(r.code).toBe(0);
  });

  it('exits 2 when the source is not the pinned cluster, and reports the pin when it matches', () => {
    const wrong = drill(makeStubs('sysid-wrong'), { DRILL_EXPECTED_SOURCE_SYSID: '7000000000000000009' });
    expect(wrong.code).toBe(2);
    expect(wrong.out).toMatch(/not the pinned cluster/);
    const ok = drill(makeStubs('sysid-ok'), { DRILL_EXPECTED_SOURCE_SYSID: '7000000000000000001' });
    expect(ok.code).toBe(0);
    expect(ok.summary).toMatch(/Source identity \| pinned/);
    // …and an unpinned run says so rather than implying identity was checked.
    expect(drill(makeStubs('sysid-unset')).summary).toMatch(/Source identity \| NOT pinned/);
  });
});

describe('run-drill.sh — remaining did-not-run and found-a-problem paths', () => {
  it('exits 2 when the target public schema already has relations, dropping nothing', () => {
    const stubs = makeStubs('public-not-empty');
    const r = drill(stubs, { STUB_TGT_PUBLIC: '3' });
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/target public schema is not empty/);
    expect(calls(stubs.bin)).not.toMatch(/DESTRUCTIVE/);
  });

  it('exits 1 when pg_restore exits non-zero without a single classifiable error line', () => {
    const r = drill(makeStubs('restore-rc-only'), { STUB_RESTORE_RC_ONLY: '1' });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/pg_restore exited 1 without a classifiable error/);
  });

  it('exits 2 with a summary (not 141 from SIGPIPE) when the snapshot session dies', () => {
    const r = drill(makeStubs('session-dies'), { STUB_SESSION_DIES: '1' });
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/snapshot session/);
    expect(r.summary).toMatch(/DID NOT RUN/);
  });
});

describe('run-drill.sh — bearer-token table data is excluded from the drill dump', () => {
  it('passes --exclude-table-data and expects the table to restore EMPTY', () => {
    const tgt = COUNTS.replace('public.candidates\t250', 'public.candidates\t0');
    const stubs = makeStubs('exclude-ok', { counts: tgt });
    const r = drill(stubs, { DRILL_EXCLUDE_TABLE_DATA: 'public.candidates' });
    expect(r.code).toBe(0);
    expect(readFileSync(join(stubs.bin, 'dump-args'), 'utf8')).toMatch(/^--exclude-table-data=public\.candidates$/m);
    expect(r.out).toMatch(/NOT dumped .*public\.candidates/);
  });

  it('exits 1 if an excluded table restores WITH rows (its data leaked into the dump)', () => {
    const r = drill(makeStubs('exclude-leak'), { DRILL_EXCLUDE_TABLE_DATA: 'public.candidates' });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/public\.candidates\t0\t250/);
  });

  it('exits 2 on an excluded table outside the dumped schemas', () => {
    const r = drill(makeStubs('exclude-outside'), { DRILL_EXCLUDE_TABLE_DATA: 'vault.secrets' });
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/outside the dumped schemas/);
  });

  it('capture ignores the exclusion — evidence and dump for a real restore stay complete', () => {
    const stubs = makeStubs('exclude-capture');
    const ev = join(stubs.bin, 'ex.evidence');
    const r = drill(
      stubs,
      { DRILL_TARGET_URL: undefined, DRILL_TARGET_MARKER: undefined, DRILL_EXCLUDE_TABLE_DATA: 'public.candidates' },
      ['capture', ev, join(stubs.bin, 'ex.dump')],
    );
    expect(r.code).toBe(0);
    expect(readFileSync(join(stubs.bin, 'dump-args'), 'utf8')).not.toMatch(/exclude-table-data/);
    expect(readFileSync(ev, 'utf8')).toMatch(/^COUNT\tpublic\.candidates\t250$/m);
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

describe('run-drill.sh capture/verify — a restored destination is checked against SAVED source evidence', () => {
  const evidence = (name: string, counts = COUNTS, inventory = INVENTORY): string => {
    const f = join(sandbox, `${name}.evidence`);
    writeFileSync(
      f,
      '# tims-backup-drill evidence v1\n# captured_at=2026-09-29T00:00:00Z\n# schemas=public auth\n' +
        counts +
        inventory,
    );
    return f;
  };

  it('capture writes evidence (metadata only) and a dump at the same snapshot, touching no target', () => {
    const stubs = makeStubs('capture');
    const ev = join(stubs.bin, 'out.evidence');
    const dump = join(stubs.bin, 'out.dump');
    const r = drill(stubs, { DRILL_TARGET_URL: undefined, DRILL_TARGET_MARKER: undefined }, ['capture', ev, dump]);
    expect(r.out).toMatch(/CAPTURED/);
    expect(r.code).toBe(0);
    const text = readFileSync(ev, 'utf8');
    expect(text.split('\n')[0]).toBe('# tims-backup-drill evidence v1');
    expect(text).toMatch(/^# snapshot=00000003-0000001B-1$/m);
    expect(text).toMatch(/^COUNT\tpublic\.candidates\t250$/m);
    expect(text).toMatch(/^INV\tPOLICY public\.candidates tenant_isolation/m);
    expect(readFileSync(dump, 'utf8')).toMatch(/PGDMP/);
    expect(calls(stubs.bin)).not.toMatch(/connect tgt/);

    // …and that evidence verifies a destination that matches it (round trip).
    const v = drill(makeStubs('capture-roundtrip'), { DRILL_VERIFY_URL: TGT_URL }, ['verify', ev]);
    expect(v.code).toBe(0);
    expect(v.out).toMatch(/DESTINATION MATCHES THE EVIDENCE/);
  });

  it('verify exits 0 when the destination matches the evidence', () => {
    const r = drill(makeStubs('verify-ok'), { DRILL_VERIFY_URL: TGT_URL }, ['verify', evidence('ok')]);
    expect(r.code).toBe(0);
  });

  it('verify exits 1 when the destination is missing rows', () => {
    const stubs = makeStubs('verify-missing', { counts: COUNTS.replace('\t250\n', '\t240\n') });
    const r = drill(stubs, { DRILL_VERIFY_URL: TGT_URL }, ['verify', evidence('missing')]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/public\.candidates\t250\t240/);
    expect(r.out).toMatch(/do not cut over/);
  });

  it('verify exits 1 when the destination inventory differs from the evidence', () => {
    const stubs = makeStubs('verify-inv', { inventory: INVENTORY.split('\n')[0] + '\n' });
    const r = drill(stubs, { DRILL_VERIFY_URL: TGT_URL }, ['verify', evidence('inv')]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/schema inventory differs/);
  });

  it('verify exits 2 on a file that is not v1 evidence', () => {
    const bad = join(sandbox, 'bad.evidence');
    writeFileSync(bad, COUNTS);
    const r = drill(makeStubs('verify-bad'), { DRILL_VERIFY_URL: TGT_URL }, ['verify', bad]);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/not a v1 evidence file/);
  });

  it('verify exits 2 on evidence whose counts are all zero (floors apply to evidence too)', () => {
    const zero = COUNTS.replace(/\t\d+\n/g, '\t0\n');
    const stubs = makeStubs('verify-zero', { counts: zero });
    const r = drill(stubs, { DRILL_VERIFY_URL: TGT_URL }, ['verify', evidence('zero', zero)]);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/evidence holds 0 rows in total/);
  });

  it('verify exits 2 when the destination role cannot see every row (no BYPASSRLS)', () => {
    const r = drill(makeStubs('verify-rls'), { DRILL_VERIFY_URL: TGT_URL, STUB_BYPASS: 'false' }, ['verify', evidence('rls')]);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/destination role lacks BYPASSRLS/);
  });
});

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

  it('compares enum labels in order, domains and composite types', () => {
    // Behaviourally proven by local-e2e.sh scenario 10 (renamed enum label → exit 1).
    expect(src).toMatch(/string_agg\(quote_literal\(e\.enumlabel\), ',' ORDER BY e\.enumsortorder\)/);
    expect(src).toMatch(/'TYPE domain '/);
    expect(src).toMatch(/'TYPE composite '/);
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

  it('pins the restore target by 17.6 tag AND digest, the same reference the local e2e uses', () => {
    const ref = WORKFLOW.match(/image: supabase\/postgres:(\S+)/)?.[1];
    expect(ref).toMatch(/^17\.6\.\d+\.\d+@sha256:[0-9a-f]{64}$/);
    const e2e = readFileSync(join(REPO_ROOT, 'scripts/backup-drill/local-e2e.sh'), 'utf8');
    expect(e2e).toContain(`supabase/postgres:${ref}`);
  });

  it('pins every action by full commit SHA', () => {
    const uses = [...WORKFLOW.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
  });

  it('binds the restore target to loopback and rotates its bootstrap password to a random masked one', () => {
    expect(WORKFLOW).toMatch(/^\s+- 127\.0\.0\.1:5432:5432$/m);
    const rotate = stepRun('Replace the restore target\'s bootstrap password with a random one');
    expect(rotate).toMatch(/openssl rand/);
    expect(rotate).toMatch(/::add-mask::\$pw/);
    expect(WORKFLOW).toMatch(/DRILL_TARGET_URL: postgresql:\/\/supabase_admin:\$\{\{ env\.DRILL_TARGET_PW \}\}@localhost/);
  });

  it('sets a total-row floor so an empty source cannot verify', () => {
    const floor = Number(WORKFLOW.match(/DRILL_MIN_ROWS: '(\d+)'/)?.[1]);
    expect(floor).toBeGreaterThanOrEqual(1);
  });
});

describe('backup-restore-drill.yml — the all-tenant credential is scoped to main', () => {
  it('runs the job in the prod-backup-drill environment (where the secret must live)', () => {
    // Job-level key, not a comment: 4-space indent under `drill:`.
    expect(WORKFLOW).toMatch(/^    environment: prod-backup-drill$/m);
  });

  const guard = stepRun('Refuse to run outside main');

  it('has the main-only guard as the FIRST step, before checkout or any secret is referenced', () => {
    expect(guard).not.toBeNull();
    const firstStep = WORKFLOW.split(/^    steps:$/m)[1].match(/^\s+- (?:name|uses): (.*)$/m)?.[1];
    expect(firstStep).toBe('Refuse to run outside main');
  });

  it('the guard fails on any ref other than refs/heads/main', () => {
    for (const ref of ['refs/heads/feature/x', 'refs/pull/42/merge', 'refs/tags/v1', '']) {
      const r = exec('bash', ['-c', guard!], { DRILL_REF: ref });
      expect(r.code, ref).not.toBe(0);
      expect(r.out).toMatch(/::error title=Backup-restore drill refused::/);
    }
  });

  it('the guard passes on refs/heads/main (positive control)', () => {
    expect(exec('bash', ['-c', guard!], { DRILL_REF: 'refs/heads/main' }).code).toBe(0);
  });
});
