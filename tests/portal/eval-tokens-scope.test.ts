import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// The `eval-*` tokens in globals.css are the TIMS evaluation design (the PCA respondent app), and only the frame
// around an embedded test uses them. The ATS portal stays in the ATS design, so no other file may use an eval-* class.
const ROOT = join(__dirname, '../..');
const WEB = join(ROOT, 'apps/web');
const ALLOWED = new Set([
  'apps/web/app/(portal)/careers/[orgSlug]/dashboard/provider-frame-styles.ts',
  'apps/web/app/(portal)/careers/[orgSlug]/dashboard/provider-frame-brand.tsx',
  'apps/web/app/(portal)/careers/[orgSlug]/dashboard/provider-frame-leave.tsx',
  'apps/web/app/(portal)/careers/[orgSlug]/dashboard/provider-assessment-frame.tsx',
]);
const SKIP = new Set(['node_modules', '.next', 'public']);
const EVAL_CLASS = /(?:^|[\s'"`:])[a-z-]+-eval-[a-z0-9-]+/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    if (SKIP.has(entry)) return [];
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(entry) ? [path] : [];
  });
}

describe('eval-* design tokens stay in the assessment frame', () => {
  it('no file outside the frame uses an eval-* class', () => {
    const offenders = sources(WEB)
      .map((path) => relative(ROOT, path))
      .filter((path) => !ALLOWED.has(path))
      .filter((path) => EVAL_CLASS.test(readFileSync(join(ROOT, path), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('the frame styles do use them (the guard is looking at the right thing)', () => {
    const styles = readFileSync(join(ROOT, [...ALLOWED][0]), 'utf8');
    expect(EVAL_CLASS.test(styles)).toBe(true);
  });
});
