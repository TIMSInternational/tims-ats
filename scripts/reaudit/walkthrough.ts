/**
 * Turns journey spec step titles into a PRIVATE Markdown checklist for the owner's live walk.
 * It reads spec source text only; it never imports or runs Playwright.
 *
 *   REAUDIT_OUT_DIR=<abs dir outside repo> pnpm exec tsx scripts/reaudit/walkthrough.ts \
 *     --persona <persona> --specs <dir of *.spec.ts>
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertOutsideRepo, writeFileOutsideRepo } from './paths';
import { SLUG_RE } from './status';

export class WalkthroughError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WalkthroughError';
  }
}

// `test('title'` and `test.step('title'`, in any quote style; not `test.describe(` and not `x.test(`.
const STEP_RE = /(?<![\w.$])test(?:\.step)?\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;

export function extractStepTitles(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(STEP_RE)) {
    const quote = m[1] as string;
    const raw = m[2] ?? '';
    out.push(raw.replace(new RegExp(`\\\\${quote === '`' ? '`' : quote}`, 'g'), quote));
  }
  return out;
}

export interface JourneyFileSteps {
  file: string;
  steps: string[];
}

export function renderWalkthrough(persona: string, files: readonly JourneyFileSteps[]): string {
  const out = [`# Live walkthrough: ${persona}`, ''];
  for (const f of files) {
    out.push(`## ${f.file}`, '');
    for (const step of f.steps) out.push(`- [ ] ${step}`);
    out.push('');
  }
  return out.join('\n');
}

export function writeWalkthrough(opts: {
  persona: string;
  markdown: string;
  outDir: string;
  repoRoot: string;
}): string {
  if (!SLUG_RE.test(opts.persona)) throw new WalkthroughError(`unknown persona: ${opts.persona}`);
  const dir = assertOutsideRepo(opts.outDir, opts.repoRoot, 'walkthrough output directory');
  mkdirSync(dir, { recursive: true });
  const p = join(dir, `walkthrough-${opts.persona}.md`);
  writeFileOutsideRepo(p, opts.markdown, opts.repoRoot, 'walkthrough file');
  return p;
}

function main(argv: string[]): number {
  const arg = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const persona = arg('--persona');
  const specs = arg('--specs');
  const outDir = process.env.REAUDIT_OUT_DIR;
  if (!persona || !specs || !outDir) {
    console.error('usage: REAUDIT_OUT_DIR=<abs dir> walkthrough.ts --persona <persona> --specs <dir>');
    return 2;
  }
  const dir = resolve(specs);
  if (!existsSync(dir)) {
    console.error(`spec directory not found: ${dir}`);
    return 2;
  }
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.spec.ts'))
    .sort()
    .map((f) => ({
      file: relative(process.cwd(), join(dir, f)),
      steps: extractStepTitles(readFileSync(join(dir, f), 'utf8')),
    }));
  try {
    const p = writeWalkthrough({
      persona,
      markdown: renderWalkthrough(persona, files),
      outDir,
      repoRoot: execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim(),
    });
    console.log(`wrote ${p}`);
    return 0;
  } catch (e) {
    console.error((e as Error).message);
    return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
