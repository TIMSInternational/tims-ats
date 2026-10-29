import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseLedger } from '../../scripts/table-ownership.mjs';

// Static contract for the hand-applied EF scripts in services/Tims.Platform/db/manual/.
// These files are what the owner runs against production with psql, so they must be safe to
// re-run: every DDL statement sits inside a DO block guarded by the EF history row for its own
// migration id. Scripts dated on or after ROLLBACK_TWIN_CUTOFF must also ship a *.ROLLBACK.sql twin.
// The second half pins the shape of the platform_audit_events script (WP-03 PR-5a).

const REPO_ROOT = resolve(__dirname, '..', '..');
const MANUAL_DIR = join(REPO_ROOT, 'services', 'Tims.Platform', 'db', 'manual');
const LEDGER_PATH = join(REPO_ROOT, 'docs', 'architecture', 'table-ownership.md');
const GRANTS_PATH = join(REPO_ROOT, 'scripts', 'db', 'backfills', 'wp03-grants.sql');

const ROLLBACK_TWIN_CUTOFF = '20261001000000';
const FORWARD_RE = /^(\d{14})_([a-z0-9_]+)\.sql$/;
const ROLLBACK_SUFFIX = '.ROLLBACK.sql';
const PAE_STEM_RE = /^\d{14}_platform_audit_events$/;

function stripComments(sql: string): string {
  return sql
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
}

function forwardFiles(): string[] {
  return readdirSync(MANUAL_DIR)
    .filter((f) => f.endsWith('.sql') && !f.endsWith(ROLLBACK_SUFFIX))
    .sort();
}

function migrationId(file: string): string {
  return file.replace(/\.sql$/, '');
}

function read(file: string): string {
  return stripComments(readFileSync(join(MANUAL_DIR, file), 'utf8'));
}

function doBlocks(sql: string): string[] {
  return [...sql.matchAll(/DO \$EF\$([\s\S]*?)END \$EF\$;/g)].map((m) => m[1] ?? '');
}

function outsideDoBlocks(sql: string): string {
  return sql.replace(/DO \$EF\$[\s\S]*?END \$EF\$;/g, '');
}

function platformAuditEventsFile(): string | undefined {
  return forwardFiles().find((f) => PAE_STEM_RE.test(migrationId(f)));
}

describe('manual EF scripts are idempotent', () => {
  it('finds the manual scripts directory and at least the two legacy scripts', () => {
    expect(forwardFiles().length).toBeGreaterThanOrEqual(2);
  });

  for (const file of forwardFiles()) {
    describe(file, () => {
      const id = migrationId(file);
      const sql = read(file);
      const guard = `IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '${id}') THEN`;

      it('is named <14-digit timestamp>_<snake_name>.sql', () => {
        expect(FORWARD_RE.test(file), `${file} does not match ${FORWARD_RE}`).toBe(true);
      });

      it('creates the EF history table only if it is missing', () => {
        expect(sql).toContain('CREATE TABLE IF NOT EXISTS "__EFMigrationsHistory"');
      });

      it('guards every DO block on its own migration id in the EF history table', () => {
        const blocks = doBlocks(sql);
        expect(blocks.length, `${file} has no DO $EF$ blocks`).toBeGreaterThan(0);
        for (const block of blocks) {
          expect(block, `unguarded DO block in ${file}:\n${block}`).toContain(guard);
        }
      });

      it('runs no statement outside a guarded DO block except the history table, BEGIN and COMMIT', () => {
        const rest = outsideDoBlocks(sql)
          .replace(/CREATE TABLE IF NOT EXISTS "__EFMigrationsHistory" \([\s\S]*?\);/, '')
          .replace(/START TRANSACTION;/g, '')
          .replace(/COMMIT;/g, '')
          .trim();
        expect(rest, `unguarded SQL in ${file}`).toBe('');
      });

      it('records its own migration id in the EF history table', () => {
        expect(sql).toMatch(
          new RegExp(`INSERT INTO "__EFMigrationsHistory" \\("MigrationId", "ProductVersion"\\)\\s*VALUES \\('${id}',`),
        );
      });

      it('runs inside one transaction', () => {
        expect(sql).toContain('START TRANSACTION;');
        expect(sql.trimEnd().endsWith('COMMIT;'), `${file} does not end with COMMIT;`).toBe(true);
      });

      const stamp = FORWARD_RE.exec(file)?.[1] ?? '';
      if (stamp >= ROLLBACK_TWIN_CUTOFF) {
        it('ships a ROLLBACK twin', () => {
          expect(existsSync(join(MANUAL_DIR, `${id}${ROLLBACK_SUFFIX}`)), `${id}${ROLLBACK_SUFFIX} missing`).toBe(true);
        });
      }
    });
  }
});

describe('platform_audit_events manual DDL (WP-03 PR-5a)', () => {
  it('exists exactly once in db/manual', () => {
    const matches = forwardFiles().filter((f) => PAE_STEM_RE.test(migrationId(f)));
    expect(matches, 'expected one <ts>_platform_audit_events.sql in services/Tims.Platform/db/manual').toHaveLength(1);
  });

  it('creates the table with the planned columns and no foreign key', () => {
    const file = platformAuditEventsFile();
    expect(file, 'platform_audit_events script missing').toBeDefined();
    const sql = read(file ?? '');
    const create = /CREATE TABLE platform_audit_events \(([\s\S]*?)\n\s*\);/.exec(sql)?.[1] ?? '';
    expect(create, 'CREATE TABLE platform_audit_events not found').not.toBe('');
    for (const column of [
      /\bid uuid NOT NULL/,
      /\bactor_id uuid,/,
      /\baction text NOT NULL/,
      /\bentity text NOT NULL/,
      /\bentity_id text,/,
      /\borganization_id uuid,/,
      /\bchanges jsonb,/,
      /\bmetadata jsonb,/,
      /\bip_address text,/,
      /\buser_agent text,/,
      /\bcreated_at timestamp with time zone NOT NULL DEFAULT \(now\(\)\)/,
    ]) {
      expect(create).toMatch(column);
    }
    expect(sql).not.toMatch(/\bREFERENCES\b/);
    expect(sql).not.toMatch(/FOREIGN KEY/);
  });

  it('indexes created_at desc and (action, created_at desc)', () => {
    const sql = read(platformAuditEventsFile() ?? '');
    expect(sql).toMatch(/CREATE INDEX \w+ ON platform_audit_events \(created_at DESC\);/);
    expect(sql).toMatch(/CREATE INDEX \w+ ON platform_audit_events \(action, created_at DESC\);/);
  });

  it('refuses to run when the shared append-only guard is missing, and never redefines it', () => {
    const sql = read(platformAuditEventsFile() ?? '');
    expect(sql).toContain("to_regprocedure('public.tims_append_only_guard()')");
    expect(sql).not.toMatch(/CREATE (OR REPLACE )?FUNCTION\s+(public\.)?tims_append_only_guard/i);
  });

  it('attaches the append-only guard to row writes and TRUNCATE, enabled ALWAYS', () => {
    const sql = read(platformAuditEventsFile() ?? '');
    expect(sql).toMatch(
      /CREATE TRIGGER platform_audit_events_append_only BEFORE UPDATE OR DELETE ON platform_audit_events FOR EACH ROW EXECUTE FUNCTION public\.tims_append_only_guard\(\);/,
    );
    expect(sql).toMatch(
      /CREATE TRIGGER platform_audit_events_append_only_truncate BEFORE TRUNCATE ON platform_audit_events FOR EACH STATEMENT EXECUTE FUNCTION public\.tims_append_only_guard\(\);/,
    );
    expect(sql).toContain('ALTER TABLE platform_audit_events ENABLE ALWAYS TRIGGER platform_audit_events_append_only;');
    expect(sql).toContain(
      'ALTER TABLE platform_audit_events ENABLE ALWAYS TRIGGER platform_audit_events_append_only_truncate;',
    );
  });

  it('enables RLS with a deny-all policy for app_tenant and grants nothing to tenant roles', () => {
    const sql = read(platformAuditEventsFile() ?? '');
    expect(sql).toContain('ALTER TABLE platform_audit_events ENABLE ROW LEVEL SECURITY;');
    expect(sql).toMatch(
      /CREATE POLICY \w+ ON platform_audit_events AS RESTRICTIVE FOR ALL TO app_tenant USING \(false\) WITH CHECK \(false\);/,
    );
    expect(sql).toContain('REVOKE ALL ON platform_audit_events FROM PUBLIC, app_tenant, anon, authenticated;');
    expect(sql).not.toMatch(/GRANT [^;]* ON platform_audit_events TO/i);
  });

  it('has a ROLLBACK twin that drops only this table and forgets its history row', () => {
    const file = platformAuditEventsFile();
    expect(file, 'platform_audit_events script missing').toBeDefined();
    const id = migrationId(file ?? 'missing.sql');
    const twinPath = join(MANUAL_DIR, `${id}${ROLLBACK_SUFFIX}`);
    expect(existsSync(twinPath), `${id}${ROLLBACK_SUFFIX} missing`).toBe(true);
    const twin = stripComments(readFileSync(twinPath, 'utf8'));
    expect(twin).toContain('START TRANSACTION;');
    expect(twin.trimEnd().endsWith('COMMIT;')).toBe(true);
    expect(twin).toContain('DROP TABLE IF EXISTS platform_audit_events;');
    expect(twin).toContain(`DELETE FROM "__EFMigrationsHistory" WHERE "MigrationId" = '${id}';`);
    expect(twin).not.toMatch(/DROP FUNCTION/i);
    expect(twin).not.toMatch(/DROP TABLE(?! IF EXISTS platform_audit_events;)/);
  });

  it('is registered as EF-owned in the table-ownership ledger', () => {
    const ledger = parseLedger(readFileSync(LEDGER_PATH, 'utf8'));
    expect(ledger.efcore).toContain('platform_audit_events');
  });

  it('ships the WP-03 grants file revoking tenant-role access', () => {
    expect(existsSync(GRANTS_PATH), 'scripts/db/backfills/wp03-grants.sql missing').toBe(true);
    const grants = stripComments(readFileSync(GRANTS_PATH, 'utf8'));
    expect(grants).toContain('REVOKE ALL ON platform_audit_events FROM PUBLIC, app_tenant, anon, authenticated;');
    expect(grants).not.toMatch(/\bGRANT\b/i);
  });
});
