import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The `eval-*` tokens in globals.css are the TIMS evaluation design (the PCA respondent app). Only the candidate
// dashboard uses them: every file DIRECTLY in its folder (the shell, its sections, its eval-* primitives and the frame
// around an embedded test), so the candidate goes from the dashboard to the test inside one look. Everything else in
// apps/web stays in the ATS design and may not use an eval-* class: the staff app, the other portal pages (job board,
// login, apply, privacy notice), the shared components in apps/web/components (staff pages use them too), and the legacy
// player in the dashboard's own assessments/ subfolder.
//
// Two ways the design could leak, so two guards: writing an eval-* class (or its CSS variables, or the `tims-eval` root
// class) outside the folder, and IMPORTING something from the folder (EvalButton, EvalSheet, an EVAL_* constant…) into
// a file outside it, which carries the eval-* classes along without writing one.
const ROOT = join(__dirname, '../..');
const WEB = join(ROOT, 'apps/web');
const DASHBOARD = 'apps/web/app/(portal)/careers/[orgSlug]/dashboard';
const DASHBOARD_ABS = join(ROOT, DASHBOARD);
const SKIP = new Set(['node_modules', '.next', 'public']);
/** An eval-* utility (`bg-eval-navy`, `md:text-eval-sm`), an eval CSS variable (`bg-[var(--color-eval-navy)]`), or the
 * root class that switches the PCA focus ring on (`tims-eval`). */
const EVAL_CLASS =
  /(?:^|[\s'"`:])[a-z-]+-eval-[a-z0-9-]+|--(?:color|font|text|radius|shadow|animate)-eval-|\btims-eval\b/;
/** Every module specifier in a file: `from '…'`, `import('…')`, `require('…')`, and side-effect `import '…'`. */
const SPECIFIER = /(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;
/** A non-relative specifier that names a module directly in the dashboard folder (the `@/` alias, an absolute path). */
const DASHBOARD_SPECIFIER = /careers\/\[orgSlug\]\/dashboard\/(?!assessments\/)[^/]+$/;

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

/** The specifiers in `source` (a file at repo-relative `path`) that reach a module directly in the dashboard folder. */
function dashboardImports(path: string, source: string): string[] {
  return [...source.matchAll(SPECIFIER)]
    .map((match) => match[1]!)
    .filter((specifier) =>
      specifier.startsWith('.')
        ? dirname(resolve(ROOT, dirname(path), specifier)) === DASHBOARD_ABS
        : DASHBOARD_SPECIFIER.test(specifier),
    );
}

describe('eval-* design tokens stay in the candidate dashboard', () => {
  it('no file outside the dashboard folder (or in its subfolders) uses an eval-* class', () => {
    const offenders = sources(WEB)
      .map((path) => relative(ROOT, path))
      .filter((path) => !allowed(path))
      .filter(usesEval);
    expect(offenders).toEqual([]);
  });

  it('no file outside the dashboard folder (or in its subfolders) imports from it', () => {
    const offenders = sources(WEB)
      .map((path) => relative(ROOT, path))
      .filter((path) => !allowed(path))
      .flatMap((path) => dashboardImports(path, readFileSync(join(ROOT, path), 'utf8')).map((s) => `${path} → ${s}`));
    expect(offenders).toEqual([]);
  });

  it('the allowed set is the dashboard folder only, not its assessments/ subfolder', () => {
    expect(allowed(`${DASHBOARD}/dashboard-shell.tsx`)).toBe(true);
    expect(allowed(`${DASHBOARD}/assessments/[assignmentId]/page.tsx`)).toBe(false);
    expect(allowed('apps/web/app/(portal)/careers/[orgSlug]/login/page.tsx')).toBe(false);
    expect(allowed('apps/web/components/button.tsx')).toBe(false);
  });

  it('the class guard sees utilities, the eval CSS variables and the tims-eval root class', () => {
    expect(EVAL_CLASS.test("className='bg-eval-navy'")).toBe(true);
    expect(EVAL_CLASS.test('className="md:text-eval-sm"')).toBe(true);
    expect(EVAL_CLASS.test("className='bg-[var(--color-eval-navy)]'")).toBe(true);
    expect(EVAL_CLASS.test("className='font-[var(--font-eval-serif)]'")).toBe(true);
    expect(EVAL_CLASS.test("className='tims-eval p-4'")).toBe(true);
    expect(EVAL_CLASS.test("className='bg-surface text-primary'")).toBe(false);
    expect(EVAL_CLASS.test('const evaluation = retrieval;')).toBe(false);
  });

  it('the import guard sees relative, alias and dynamic imports into the folder, and nothing else', () => {
    const component = 'apps/web/components/zz-probe.tsx';
    const legacyPlayer = `${DASHBOARD}/assessments/[assignmentId]/page.tsx`;
    expect(
      dashboardImports(
        component,
        "import { EvalButton } from '../app/(portal)/careers/[orgSlug]/dashboard/eval-button';",
      ),
    ).toHaveLength(1);
    expect(
      dashboardImports(
        component,
        "import { EVAL_PANEL_CLASSES } from '@/app/(portal)/careers/[orgSlug]/dashboard/eval-styles';",
      ),
    ).toHaveLength(1);
    expect(
      dashboardImports(component, "const m = import('../app/(portal)/careers/[orgSlug]/dashboard/eval-sheet');"),
    ).toHaveLength(1);
    expect(dashboardImports(legacyPlayer, "import { EvalChip } from '../../eval-chip';")).toHaveLength(1);
    // The legacy player's own modules, and everything else, are not the dashboard folder.
    expect(dashboardImports(legacyPlayer, "import { x } from '../_lib/assessment-draft-storage';")).toEqual([]);
    expect(dashboardImports(legacyPlayer, "import { y } from './assessment-timer';")).toEqual([]);
    expect(dashboardImports(component, "import { t } from '../lib/i18n';")).toEqual([]);
    expect(
      dashboardImports(component, "import { z } from '@/app/(portal)/careers/[orgSlug]/dashboard/assessments/x';"),
    ).toEqual([]);
  });

  it('the dashboard does use them (the guard is looking at the right thing)', () => {
    for (const file of [
      'provider-frame-styles.ts',
      'eval-styles.ts',
      'eval-control-styles.ts',
      'dashboard-styles.ts',
    ]) {
      expect(usesEval(`${DASHBOARD}/${file}`), file).toBe(true);
    }
  });
});
