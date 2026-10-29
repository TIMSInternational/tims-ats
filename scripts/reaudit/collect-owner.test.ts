import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runOwnerChecks, type OwnerCheckRunner } from './collect-owner';
import { statusById } from './status';

// Owner checks are read-only scripts kept OUTSIDE the repo (`<checksDir>/<id>.sh`). Exit codes mirror
// scripts/verification/codex-review.sh: 0 = fixed, 1 = open, 2 = NOT RUN. Like that wrapper, a bare
// exit 0 is NOT trusted — the script must also print a `RESULT: FIXED` line, or it is NOT-RUN.

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'reaudit-owner-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function fakeRunner(byId: Record<string, { exitCode: number | null; stdout: string }>): OwnerCheckRunner {
  return vi.fn((scriptPath: string) => {
    const id = scriptPath.split('/').pop()?.replace(/\.sh$/, '') ?? '';
    return byId[id] ?? { exitCode: 127, stdout: '' };
  });
}

function touch(id: string): void {
  writeFileSync(join(dir, `${id}.sh`), '#!/usr/bin/env bash\nexit 2\n');
}

describe('runOwnerChecks', () => {
  it('is not run at all without --with-owner-checks', () => {
    touch('syn-a');
    const run = fakeRunner({ 'syn-a': { exitCode: 0, stdout: 'RESULT: FIXED' } });
    expect(runOwnerChecks({ enabled: false, checksDir: dir, ids: ['syn-a'], run })).toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });

  it('exit 0 + RESULT: FIXED → FIXED-VERIFIED; exit 1 → OPEN-CONFIRMED; exit 2 → NOT-RUN', () => {
    ['syn-a', 'syn-b', 'syn-c'].forEach(touch);
    const run = fakeRunner({
      'syn-a': { exitCode: 0, stdout: 'checking\nRESULT: FIXED\n' },
      'syn-b': { exitCode: 1, stdout: 'RESULT: OPEN' },
      'syn-c': { exitCode: 2, stdout: 'could not reach the database' },
    });
    const byId = statusById(runOwnerChecks({ enabled: true, checksDir: dir, ids: ['syn-a', 'syn-b', 'syn-c'], run }));
    expect(byId.get('syn-a')).toBe('FIXED-VERIFIED');
    expect(byId.get('syn-b')).toBe('OPEN-CONFIRMED');
    expect(byId.get('syn-c')).toBe('NOT-RUN');
  });

  it('fail closed: exit 0 that prints "quota" and no RESULT line → NOT-RUN', () => {
    touch('syn-a');
    const run = fakeRunner({ 'syn-a': { exitCode: 0, stdout: "You've hit your usage limit (quota)" } });
    expect(statusById(runOwnerChecks({ enabled: true, checksDir: dir, ids: ['syn-a'], run })).get('syn-a')).toBe(
      'NOT-RUN',
    );
  });

  it('fail closed: exit 0 with NO output → NOT-RUN', () => {
    touch('syn-a');
    const run = fakeRunner({ 'syn-a': { exitCode: 0, stdout: '' } });
    expect(statusById(runOwnerChecks({ enabled: true, checksDir: dir, ids: ['syn-a'], run })).get('syn-a')).toBe(
      'NOT-RUN',
    );
  });

  it('RESULT: FIXED must be a whole line, not a substring of prose', () => {
    touch('syn-a');
    const run = fakeRunner({ 'syn-a': { exitCode: 0, stdout: 'expected RESULT: FIXED but saw nothing' } });
    expect(statusById(runOwnerChecks({ enabled: true, checksDir: dir, ids: ['syn-a'], run })).get('syn-a')).toBe(
      'NOT-RUN',
    );
  });

  it('an unexpected exit code or a signal (null) → NOT-RUN', () => {
    ['syn-a', 'syn-b'].forEach(touch);
    const run = fakeRunner({
      'syn-a': { exitCode: 3, stdout: 'RESULT: FIXED' },
      'syn-b': { exitCode: null, stdout: 'RESULT: FIXED' },
    });
    const byId = statusById(runOwnerChecks({ enabled: true, checksDir: dir, ids: ['syn-a', 'syn-b'], run }));
    expect(byId.get('syn-a')).toBe('NOT-RUN');
    expect(byId.get('syn-b')).toBe('NOT-RUN');
  });

  it('a missing checks directory → every requested id NOT-RUN (never a pass), and nothing is run', () => {
    const run = fakeRunner({});
    const obs = runOwnerChecks({ enabled: true, checksDir: join(dir, 'absent'), ids: ['syn-a', 'syn-b'], run });
    const byId = statusById(obs);
    expect(byId.get('syn-a')).toBe('NOT-RUN');
    expect(byId.get('syn-b')).toBe('NOT-RUN');
    expect(obs.every((o) => o.test.includes('checks directory missing'))).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });

  it('a missing script for one id → NOT-RUN for that id', () => {
    const run = fakeRunner({});
    expect(statusById(runOwnerChecks({ enabled: true, checksDir: dir, ids: ['syn-a'], run })).get('syn-a')).toBe(
      'NOT-RUN',
    );
    expect(run).not.toHaveBeenCalled();
  });

  it('an id that is not a slug is never turned into a path', () => {
    const checksDir = join(dir, 'checks');
    mkdirSync(checksDir);
    writeFileSync(join(dir, 'escape.sh'), '#!/usr/bin/env bash\nexit 0\n');
    const run = fakeRunner({ escape: { exitCode: 0, stdout: 'RESULT: FIXED' } });
    const byId = statusById(runOwnerChecks({ enabled: true, checksDir, ids: ['../escape', '../../etc/x'], run }));
    expect(byId.get('../escape')).toBe('NOT-RUN');
    expect(byId.get('../../etc/x')).toBe('NOT-RUN');
    expect(run).not.toHaveBeenCalled();
  });

  it('the default runner really executes the script (exit 0 + RESULT: FIXED; exit 0 bare)', () => {
    const ok = join(dir, 'syn-ok.sh');
    const bare = join(dir, 'syn-bare.sh');
    writeFileSync(ok, '#!/usr/bin/env bash\necho "RESULT: FIXED"\nexit 0\n');
    writeFileSync(bare, '#!/usr/bin/env bash\necho quota\nexit 0\n');
    chmodSync(ok, 0o755);
    chmodSync(bare, 0o755);
    const byId = statusById(runOwnerChecks({ enabled: true, checksDir: dir, ids: ['syn-ok', 'syn-bare'] }));
    expect(byId.get('syn-ok')).toBe('FIXED-VERIFIED');
    expect(byId.get('syn-bare')).toBe('NOT-RUN');
  });
});
