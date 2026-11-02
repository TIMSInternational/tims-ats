/**
 * Private bindings, kept OUTSIDE the repository. They map ids that must not be named in public
 * test titles to the exact test names that cover them, and list ids checked by owner scripts.
 * Public bindings come from test tags/annotations and need no file.
 */
import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { assertOutsideRepo } from './paths';
import { SLUG_RE } from './status';

export class BindingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BindingsError';
  }
}

const slug = z.string().min(1).max(64).regex(SLUG_RE);
const testSource = z.enum(['vitest', 'xunit']);

const bindingsSchema = z
  .object({
    version: z.literal(1),
    tests: z.array(z.object({ id: slug, source: testSource, name: z.string().min(1).max(2000) }).strict()).max(5000),
    ownerChecks: z.array(slug).max(5000),
  })
  .strict();

export type TestSource = z.infer<typeof testSource>;
export type PrivateTestBinding = z.infer<typeof bindingsSchema>['tests'][number];

export interface PrivateBindings {
  present: boolean;
  tests: PrivateTestBinding[];
  ownerChecks: string[];
}

export function loadPrivateBindings(opts: { path?: string; repoRoot: string }): PrivateBindings {
  if (!opts.path) return { present: false, tests: [], ownerChecks: [] };
  const p = assertOutsideRepo(opts.path, opts.repoRoot, 'private bindings file');
  if (!existsSync(p)) throw new BindingsError(`private bindings file not found: ${p}`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    throw new BindingsError(`private bindings file is not valid JSON: ${p} (${(e as Error).message})`);
  }
  const parsed = bindingsSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new BindingsError(
      `private bindings file failed validation: ${p} (${first ? `${first.path.join('.') || '(root)'}: ${first.message}` : 'invalid'})`,
    );
  }
  return { present: true, tests: parsed.data.tests, ownerChecks: parsed.data.ownerChecks };
}

/** Exact test name -> ids, for one test source. */
export function nameBindings(b: PrivateBindings, source: TestSource): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const t of b.tests) {
    if (t.source !== source) continue;
    const ids = out.get(t.name) ?? [];
    if (!ids.includes(t.id)) ids.push(t.id);
    out.set(t.name, ids);
  }
  return out;
}

/** Bound ids that the findings file does not contain (sorted): a stale binding is reported. */
export function unknownBindingIds(b: PrivateBindings, findingIds: readonly string[]): string[] {
  const known = new Set(findingIds);
  const bound = new Set([...b.tests.map((t) => t.id), ...b.ownerChecks]);
  return [...bound].filter((id) => !known.has(id)).sort();
}
