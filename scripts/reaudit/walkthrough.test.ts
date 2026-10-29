import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  readFileSync,
  readdirSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractStepTitles, renderWalkthrough, writeWalkthrough, WalkthroughError } from './walkthrough';

// Turns journey spec step titles into a PRIVATE Markdown checklist for the owner's live walk.
// It reads the spec source text only (it never imports or runs Playwright).

const SPEC = `
import { test } from '@playwright/test';
test.describe('J1 publish a vacancy', () => {
  test('recruiter publishes a vacancy', async ({ page }) => {
    await test.step('sign in as the recruiter', async () => {});
    await test.step("open the vacancies list", async () => {});
    await test.step(\`create a draft vacancy\`, async () => {});
  });
});
`;

describe('extractStepTitles', () => {
  it('extracts test and test.step titles in source order, for all three quote styles', () => {
    expect(extractStepTitles(SPEC)).toEqual([
      'recruiter publishes a vacancy',
      'sign in as the recruiter',
      'open the vacancies list',
      'create a draft vacancy',
    ]);
  });

  it('a template title with an interpolation is kept verbatim, not evaluated', () => {
    expect(extractStepTitles('await test.step(`approve ${id}`, async () => {});')).toEqual(['approve ${id}']);
  });

  it('a file with no steps yields an empty list', () => {
    expect(extractStepTitles('export const x = 1;')).toEqual([]);
  });

  it('ignores calls that merely end in "test(" (regex .test, latest, attest)', () => {
    expect(extractStepTitles("const ok = /x/.test('nope'); latest('nope'); attest('nope');")).toEqual([]);
  });

  it('unescapes an escaped quote of the same style', () => {
    expect(extractStepTitles("await test.step('it\\'s done', async () => {});")).toEqual(["it's done"]);
  });
});

describe('renderWalkthrough', () => {
  it('renders a checklist with one unchecked box per step, grouped by journey file', () => {
    const md = renderWalkthrough('recruiter', [{ file: 'recruiter/j1.spec.ts', steps: ['a', 'b'] }]);
    expect(md).toContain('recruiter');
    expect(md).toContain('recruiter/j1.spec.ts');
    expect(md).toContain('- [ ] a');
    expect(md).toContain('- [ ] b');
  });
});

describe('writeWalkthrough', () => {
  let root: string;
  let repo: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'reaudit-walk-')));
    repo = join(root, 'repo');
    mkdirSync(repo, { recursive: true });
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('writes walkthrough-<persona>.md outside the repo', () => {
    const out = join(root, 'private');
    const p = writeWalkthrough({ persona: 'recruiter', markdown: '- [ ] a\n', outDir: out, repoRoot: repo });
    expect(p).toBe(join(out, 'walkthrough-recruiter.md'));
    expect(readFileSync(p, 'utf8')).toBe('- [ ] a\n');
  });

  it('refuses an output dir inside the repo and writes nothing', () => {
    expect(() =>
      writeWalkthrough({ persona: 'recruiter', markdown: 'x', outDir: join(repo, 'out'), repoRoot: repo }),
    ).toThrow(/inside the repository/i);
    expect(readdirSync(repo)).toEqual([]);
  });

  it('refuses to follow a pre-existing walkthrough-file symlink into the repo', () => {
    const out = join(root, 'private');
    mkdirSync(out, { recursive: true });
    const target = join(repo, 'tracked.md');
    writeFileSync(target, 'tracked\n');
    symlinkSync(target, join(out, 'walkthrough-recruiter.md'));
    expect(() => writeWalkthrough({ persona: 'recruiter', markdown: 'x', outDir: out, repoRoot: repo })).toThrow();
    expect(readFileSync(target, 'utf8')).toBe('tracked\n');
  });

  it('refuses an unknown persona (it becomes part of a file name)', () => {
    expect(() =>
      writeWalkthrough({ persona: '../escape', markdown: 'x', outDir: join(root, 'private'), repoRoot: repo }),
    ).toThrow(WalkthroughError);
  });
});
