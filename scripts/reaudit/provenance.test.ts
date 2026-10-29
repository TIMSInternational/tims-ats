import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, realpathSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { manifestPathFor, ProvenanceError, verifyProvenance, writeProvenance } from './provenance';

// Provenance replaces the old "report is newer than HEAD's commit time" heuristic. The step that runs the
// tests (scripts/reaudit/record.ts) records the git SHA it ran at, whether the tree was clean, the run's
// exit status and a SHA-256 of every report file. The collector refuses evidence whose manifest is
// missing, names another SHA, or whose files no longer match their recorded hashes.

const HEAD = '0123456789abcdef0123456789abcdef01234567';
const OTHER = 'fedcba9876543210fedcba9876543210fedcba98';

let dir: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'reaudit-prov-')));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function fileEvidence(kind: 'playwright' | 'vitest' = 'vitest', over: Partial<{ sha: string; dirty: string[] }> = {}) {
  const p = join(dir, `${kind}.json`);
  writeFileSync(p, '{"x":1}');
  writeProvenance({
    kind,
    output: p,
    headSha: over.sha ?? HEAD,
    dirtyPaths: over.dirty ?? [],
    exitCode: 0,
    checkoutRoot: '/abs/repo',
  });
  return p;
}

function trxEvidence() {
  const d = join(dir, 'trx');
  mkdirSync(d);
  writeFileSync(join(d, 'a.trx'), '<a/>');
  writeFileSync(join(d, 'b.trx'), '<b/>');
  writeProvenance({ kind: 'xunit', output: d, headSha: HEAD, dirtyPaths: [], exitCode: 0, checkoutRoot: '/abs/repo' });
  return d;
}

describe('verifyProvenance: file evidence', () => {
  it('evidence recorded at HEAD is accepted and its verified bytes are returned', () => {
    const p = fileEvidence();
    const v = verifyProvenance({ kind: 'vitest', evidence: p, headSha: HEAD, requireClean: true });
    expect(v.files.get('vitest.json')?.toString('utf8')).toBe('{"x":1}');
    expect(v.manifest.exitCode).toBe(0);
  });

  it('file timestamps play no part: evidence of HEAD with an old mtime is accepted', () => {
    const p = fileEvidence();
    const old = new Date('2001-01-01T00:00:00Z');
    utimesSync(p, old, old);
    utimesSync(manifestPathFor(p, 'vitest'), old, old);
    expect(() => verifyProvenance({ kind: 'vitest', evidence: p, headSha: HEAD, requireClean: true })).not.toThrow();
  });

  it('evidence recorded at another commit is refused, naming both SHAs and the file', () => {
    const p = fileEvidence('vitest', { sha: OTHER });
    let msg = '';
    try {
      verifyProvenance({ kind: 'vitest', evidence: p, headSha: HEAD, requireClean: false });
    } catch (e) {
      expect(e).toBeInstanceOf(ProvenanceError);
      msg = (e as Error).message;
    }
    expect(msg).toContain(OTHER);
    expect(msg).toContain(HEAD);
    expect(msg).toContain(p);
  });

  it('evidence with no manifest is refused and the recorder is named', () => {
    const p = join(dir, 'bare.json');
    writeFileSync(p, '{}');
    expect(() => verifyProvenance({ kind: 'vitest', evidence: p, headSha: HEAD, requireClean: false })).toThrow(
      /record\.ts/,
    );
  });

  it('a report replaced after it was recorded (hash mismatch) is refused', () => {
    const p = fileEvidence();
    writeFileSync(p, '{"x":2}');
    expect(() => verifyProvenance({ kind: 'vitest', evidence: p, headSha: HEAD, requireClean: false })).toThrow(
      /SHA-256/,
    );
  });

  it('a manifest recorded for another kind of report is refused', () => {
    const p = fileEvidence('playwright');
    expect(() => verifyProvenance({ kind: 'vitest', evidence: p, headSha: HEAD, requireClean: false })).toThrow(
      ProvenanceError,
    );
  });

  it('evidence produced from a dirty tree is refused when a clean tree is required, accepted otherwise', () => {
    const p = fileEvidence('vitest', { dirty: ['e2e/extra.spec.ts'] });
    expect(() => verifyProvenance({ kind: 'vitest', evidence: p, headSha: HEAD, requireClean: true })).toThrow(
      /e2e\/extra\.spec\.ts/,
    );
    expect(() => verifyProvenance({ kind: 'vitest', evidence: p, headSha: HEAD, requireClean: false })).not.toThrow();
  });

  it('a manifest with an unknown key or a malformed SHA is rejected (strict schema)', () => {
    const p = fileEvidence();
    const m = manifestPathFor(p, 'vitest');
    const good = JSON.parse(readFileSync(m, 'utf8')) as Record<string, unknown>;
    writeFileSync(m, JSON.stringify({ ...good, trusted: true }));
    expect(() => verifyProvenance({ kind: 'vitest', evidence: p, headSha: HEAD, requireClean: false })).toThrow(
      ProvenanceError,
    );
    writeFileSync(m, JSON.stringify({ ...good, headSha: 'HEAD' }));
    expect(() => verifyProvenance({ kind: 'vitest', evidence: p, headSha: 'HEAD', requireClean: false })).toThrow(
      ProvenanceError,
    );
  });

  it('a manifest without the absolute checkout root of the run is rejected (evidence paths are resolved against it)', () => {
    const p = fileEvidence();
    const m = manifestPathFor(p, 'vitest');
    const good = JSON.parse(readFileSync(m, 'utf8')) as Record<string, unknown>;
    expect(good.checkoutRoot).toBe('/abs/repo');
    for (const bad of [undefined, '', 'relative/root']) {
      writeFileSync(m, JSON.stringify({ ...good, checkoutRoot: bad }));
      expect(() => verifyProvenance({ kind: 'vitest', evidence: p, headSha: HEAD, requireClean: false })).toThrow(
        ProvenanceError,
      );
    }
  });

  it('a manifest that says clean while listing dirty paths is rejected', () => {
    const p = fileEvidence('vitest', { dirty: ['x.ts'] });
    const m = manifestPathFor(p, 'vitest');
    const good = JSON.parse(readFileSync(m, 'utf8')) as Record<string, unknown>;
    writeFileSync(m, JSON.stringify({ ...good, dirty: false }));
    expect(() => verifyProvenance({ kind: 'vitest', evidence: p, headSha: HEAD, requireClean: true })).toThrow(
      ProvenanceError,
    );
  });

  it('an unparseable HEAD sha from the caller is refused (never compared loosely)', () => {
    const p = fileEvidence();
    expect(() => verifyProvenance({ kind: 'vitest', evidence: p, headSha: '', requireClean: false })).toThrow(
      ProvenanceError,
    );
  });
});

describe('verifyProvenance: TRX directory evidence', () => {
  it('every recorded file verified → accepted, all .trx contents returned', () => {
    const d = trxEvidence();
    const v = verifyProvenance({ kind: 'xunit', evidence: d, headSha: HEAD, requireClean: true });
    expect([...v.files.keys()].sort()).toEqual(['a.trx', 'b.trx']);
  });

  it('a .trx file added after recording (not in the manifest) is refused, named', () => {
    const d = trxEvidence();
    writeFileSync(join(d, 'old-run.trx'), '<old/>');
    expect(() => verifyProvenance({ kind: 'xunit', evidence: d, headSha: HEAD, requireClean: false })).toThrow(
      /old-run\.trx/,
    );
  });

  it('a recorded file that is gone is refused', () => {
    const d = trxEvidence();
    rmSync(join(d, 'b.trx'));
    expect(() => verifyProvenance({ kind: 'xunit', evidence: d, headSha: HEAD, requireClean: false })).toThrow(
      /b\.trx/,
    );
  });

  it('a recorded .trx whose content changed is refused', () => {
    const d = trxEvidence();
    writeFileSync(join(d, 'a.trx'), '<changed/>');
    expect(() => verifyProvenance({ kind: 'xunit', evidence: d, headSha: HEAD, requireClean: false })).toThrow(
      /a\.trx/,
    );
  });
});

describe('writeProvenance', () => {
  it('never overwrites an existing manifest (a stale manifest cannot be silently refreshed)', () => {
    const p = fileEvidence();
    expect(() =>
      writeProvenance({ kind: 'vitest', output: p, headSha: HEAD, dirtyPaths: [], exitCode: 0, checkoutRoot: '/r' }),
    ).toThrow();
  });
});
