import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// The `eval-*` tokens in globals.css are the TIMS evaluation design (the PCA respondent app). Only the candidate
// dashboard uses them: every file DIRECTLY in its folder (the shell, its sections, its eval-* primitives and the frame
// around an embedded test), so the candidate goes from the dashboard to the test inside one look. Everything else in
// apps/web stays in the ATS design and may not use an eval-* class: the staff app, the other portal pages (job board,
// login, apply, privacy notice), the shared components in apps/web/components (staff pages use them too), and the legacy
// player in the dashboard's own assessments/ subfolder.
const ROOT = join(__dirname, '../..');
const WEB = join(ROOT, 'apps/web');
const DASHBOARD = 'apps/web/app/(portal)/careers/[orgSlug]/dashboard';
const SKIP = new Set(['node_modules', '.next', 'public']);
const EVAL_CLASS = /(?:^|[\s'"`:])[a-z-]+-eval-[a-z0-9-]+/;

/** Directly in the dashboard folder: never a file in one of its subfolders. */
const allowed = (path: string) => dirname(path) === DASHBOARD;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    if (SKIP.has(entry)) return [];
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(entry) ? [path] : [];
  });
}

const usesEval = (path: string) => EVAL_CLASS.test(readFileSync(join(ROOT, path), 'utf8'));

describe('eval-* design tokens stay in the candidate dashboard', () => {
  it('no file outside the dashboard folder (or in its subfolders) uses an eval-* class', () => {
    const offenders = sources(WEB)
      .map((path) => relative(ROOT, path))
      .filter((path) => !allowed(path))
      .filter(usesEval);
    expect(offenders).toEqual([]);
  });

  it('the allowed set is the dashboard folder only, not its assessments/ subfolder', () => {
    expect(allowed(`${DASHBOARD}/dashboard-shell.tsx`)).toBe(true);
    expect(allowed(`${DASHBOARD}/assessments/[assignmentId]/page.tsx`)).toBe(false);
    expect(allowed('apps/web/app/(portal)/careers/[orgSlug]/login/page.tsx')).toBe(false);
    expect(allowed('apps/web/components/button.tsx')).toBe(false);
  });

  it('the dashboard does use them (the guard is looking at the right thing)', () => {
    for (const file of ['provider-frame-styles.ts', 'eval-styles.ts', 'eval-control-styles.ts', 'dashboard-styles.ts']) {
      expect(usesEval(`${DASHBOARD}/${file}`), file).toBe(true);
    }
  });
});
