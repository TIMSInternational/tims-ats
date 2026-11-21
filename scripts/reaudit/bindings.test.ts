import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPrivateBindings, nameBindings, unknownBindingIds, BindingsError } from './bindings';

// Private bindings (kept OUTSIDE the repo) map ids that must not be named in public test titles to the
// exact test names that cover them, and list ids checked by owner scripts. Public bindings come from
// test tags/annotations and need no file.

let root: string;
let repo: string;
let outside: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'reaudit-bindings-')));
  repo = join(root, 'repo');
  outside = join(root, 'private');
  mkdirSync(repo, { recursive: true });
  mkdirSync(outside, { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const valid = {
  version: 1,
  tests: [
    { id: 'syn-sec-1', source: 'vitest', name: 'security denies cross-org read' },
    { id: 'syn-sec-2', source: 'vitest', name: 'security denies cross-org read' },
    { id: 'syn-sec-3', source: 'xunit', name: 'Syn.Gate.Denies' },
  ],
  ownerChecks: ['syn-owner-1'],
};

function put(content: unknown, name = 'bindings.private.json'): string {
  const p = join(outside, name);
  writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content));
  return p;
}

describe('loadPrivateBindings', () => {
  it('no path configured → present:false and empty (public bindings still work)', () => {
    expect(loadPrivateBindings({ repoRoot: repo })).toEqual({ present: false, tests: [], ownerChecks: [] });
  });

  it('a valid file outside the repo loads', () => {
    const b = loadPrivateBindings({ path: put(valid), repoRoot: repo });
    expect(b.present).toBe(true);
    expect(b.tests).toHaveLength(3);
    expect(b.ownerChecks).toEqual(['syn-owner-1']);
  });

  it('refuses a path inside the repo (private data never lives in the public tree)', () => {
    const p = join(repo, 'bindings.private.json');
    writeFileSync(p, JSON.stringify(valid));
    expect(() => loadPrivateBindings({ path: p, repoRoot: repo })).toThrow(/inside the repository/i);
  });

  it('an explicitly configured path that does not exist throws with the path (misconfiguration is loud)', () => {
    const p = join(outside, 'absent.json');
    expect(() => loadPrivateBindings({ path: p, repoRoot: repo })).toThrow(p);
  });

  it('rejects an unknown key', () => {
    expect(() => loadPrivateBindings({ path: put({ ...valid, extra: 1 }), repoRoot: repo })).toThrow(BindingsError);
  });

  it('rejects a non-slug id', () => {
    const bad = { ...valid, ownerChecks: ['../x'] };
    expect(() => loadPrivateBindings({ path: put(bad), repoRoot: repo })).toThrow(BindingsError);
  });

  it('rejects an unknown source', () => {
    const bad = { ...valid, tests: [{ id: 'syn-sec-1', source: 'jest', name: 'x' }] };
    expect(() => loadPrivateBindings({ path: put(bad), repoRoot: repo })).toThrow(BindingsError);
  });

  it('rejects an unknown key inside a test binding', () => {
    const bad = { ...valid, tests: [{ id: 'syn-sec-1', source: 'vitest', name: 'x', extra: 1 }] };
    expect(() => loadPrivateBindings({ path: put(bad), repoRoot: repo })).toThrow(BindingsError);
  });

  it('rejects invalid JSON', () => {
    expect(() => loadPrivateBindings({ path: put('{'), repoRoot: repo })).toThrow(BindingsError);
  });
});

describe('nameBindings', () => {
  it('groups ids by exact test name for one source', () => {
    const b = loadPrivateBindings({ path: put(valid), repoRoot: repo });
    const v = nameBindings(b, 'vitest');
    expect(v.get('security denies cross-org read')).toEqual(['syn-sec-1', 'syn-sec-2']);
    expect(v.has('Syn.Gate.Denies')).toBe(false);
    expect(nameBindings(b, 'xunit').get('Syn.Gate.Denies')).toEqual(['syn-sec-3']);
  });

  it('a repeated binding lists its id once', () => {
    const dup = {
      ...valid,
      tests: [...valid.tests, { id: 'syn-sec-1', source: 'vitest', name: 'security denies cross-org read' }],
    };
    const b = loadPrivateBindings({ path: put(dup), repoRoot: repo });
    expect(nameBindings(b, 'vitest').get('security denies cross-org read')).toEqual(['syn-sec-1', 'syn-sec-2']);
  });
});

describe('unknownBindingIds', () => {
  it('lists bound ids that are not in the findings file (a stale binding is reported, not ignored)', () => {
    const b = loadPrivateBindings({ path: put(valid), repoRoot: repo });
    expect(unknownBindingIds(b, ['syn-sec-1', 'syn-sec-3'])).toEqual(['syn-owner-1', 'syn-sec-2']);
  });
});
