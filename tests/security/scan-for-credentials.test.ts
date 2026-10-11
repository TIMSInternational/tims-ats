import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

// #328 review MEDIUM-1: the capture job uploads a fresh production schema dump from a PUBLIC repo, and
// scripts/security/scan-for-credentials.sh is the last thing between a token in a function body and the
// internet. 0 clean · 1 hit · 2 could not run — and a hit never echoes the matching text.

const ROOT = join(__dirname, '../..');
const SCRIPT = join(ROOT, 'scripts/security/scan-for-credentials.sh');
const sandbox = mkdtempSync(join(tmpdir(), 'cred-scan-'));
afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

function scan(...paths: string[]) {
  const r = spawnSync('bash', [SCRIPT, ...paths], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

function dirWith(name: string, body: string): string {
  const d = join(sandbox, name);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'dump.sql'), body);
  return d;
}

describe('scan-for-credentials.sh', () => {
  it('the real committed baseline and flip-ddl SQL are clean (else the capture job could never upload)', () => {
    const { code, out } = scan(
      join(ROOT, 'packages/db/baseline/prod-public-schema.sql'),
      join(ROOT, 'services/Tims.Platform/db/flip-ddl/calibration.sql'),
      join(ROOT, 'services/Tims.Platform/db/flip-ddl/compensation.sql'),
      join(ROOT, 'services/Tims.Platform/db/flip-ddl/evaluation360.sql'),
      join(ROOT, 'services/Tims.Platform/db/flip-ddl/succession.sql'),
      join(ROOT, 'services/Tims.Platform/db/flip-ddl/surveys.sql'),
    );
    expect(code, out).toBe(0);
  });

  it('does not flag identifiers that merely contain a pattern fragment (risk_score)', () => {
    expect(scan(dirWith('fp', 'CREATE TABLE public.x (risk_score double precision, desk_id uuid);\n')).code).toBe(0);
  });

  const SECRETS: Array<[string, string]> = [
    // Fixtures are assembled from parts so the repo's own gitleaks hook does not flag this test file.
    ['JWT', `SELECT '${'ey' + 'J'}hbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.x';`],
    ['bearer', "PERFORM http_header('Authorization', 'Bearer abcdef0123456789');"],
    ['stripe', `v_key := '${'sk' + '_live_'}abcdefgh12345678';`],
    ['service_role', 'GRANT ALL ON public.x TO service_role;'],
    ['password', "ALTER ROLE r PASSWORD 'x'; -- password = hunter2"],
    ['apikey', 'headers := \'{"apikey": "zzz"}\';'],
    ['conn string', `dblink('${'postgresql'}://u:${'pw'}@db.example.com:5432/postgres')`],
    ['private key', `-----BEGIN RSA ${'PRIVATE'} KEY-----`],
    ['aws key', `v := '${'AK' + 'IA'}ABCDEFGHIJKLMNOP';`],
  ];
  for (const [label, line] of SECRETS) {
    it(`exits 1 on a ${label} and never prints the matching text`, () => {
      const { code, out } = scan(dirWith(`hit-${label.replace(/\W/g, '')}`, `CREATE FUNCTION f() AS $$ ${line} $$;\n`));
      expect(code).toBe(1);
      expect(out).toMatch(/dump\.sql/);
      expect(out).not.toContain(line);
    });
  }

  it('exits 2 on a missing path, an empty directory, or no arguments — never a vacuous pass', () => {
    expect(scan(join(sandbox, 'does-not-exist')).code).toBe(2);
    const empty = join(sandbox, 'empty');
    mkdirSync(empty, { recursive: true });
    expect(scan(empty).code).toBe(2);
    expect(scan().code).toBe(2);
  });
});
