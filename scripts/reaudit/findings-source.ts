/**
 * Loads and strictly validates the private findings file.
 *
 * The location comes ONLY from an explicit path or `REAUDIT_FINDINGS` — no private path is baked
 * into this public repository — and a path inside the repository is refused before it is read.
 * The schema is strict (unknown keys rejected, every string and array bounded).
 */
import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { assertOutsideRepo } from './paths';
import { SLUG_RE } from './status';

export class FindingsSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FindingsSourceError';
  }
}

const PROSE_MAX = 10_000;
const slug = z.string().min(1).max(64).regex(SLUG_RE);
const prose = z.string().max(PROSE_MAX);
const severity = z.enum(['P0', 'P1', 'P2', 'P3']);

const verificationSchema = z
  .object({
    id: slug,
    verdict: z.enum(['confirmed', 'partially-true', 'unverifiable']),
    correctedSeverity: severity,
    note: prose,
  })
  .strict();

const findingSchema = z
  .object({
    id: slug,
    persona: slug,
    lens: slug,
    category: slug,
    severity,
    title: prose,
    detail: prose,
    evidence: z.array(prose).max(100),
    userImpact: prose,
    recommendation: prose,
    fixLocation: prose,
    effort: z.enum(['S', 'M', 'L', 'XL']),
    launchScope: z.enum(['launch-v1', 'post-launch']),
    status: z.enum(['new', 'previously-reported']),
    verification: verificationSchema.nullable(),
    specRef: prose.nullable().optional(),
    alreadyAddressedByPR: prose.nullable().optional(),
  })
  .strict();

const findingsSchema = z.array(findingSchema).max(10_000);

export type Finding = z.infer<typeof findingSchema>;

function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
}

export function parseFindings(raw: unknown): Finding[] {
  const parsed = findingsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new FindingsSourceError(`findings file failed validation: ${describeIssues(parsed.error)}`);
  }
  const seen = new Set<string>();
  for (const f of parsed.data) {
    if (seen.has(f.id)) throw new FindingsSourceError(`duplicate finding id: ${f.id}`);
    seen.add(f.id);
  }
  return parsed.data;
}

export interface LoadFindingsOptions {
  path?: string;
  env: Record<string, string | undefined>;
  repoRoot: string;
}

export function loadFindings(opts: LoadFindingsOptions): Finding[] {
  const configured = opts.path ?? opts.env.REAUDIT_FINDINGS;
  if (!configured) {
    throw new FindingsSourceError('no findings file configured: set REAUDIT_FINDINGS to an absolute path');
  }
  const p = assertOutsideRepo(configured, opts.repoRoot, 'findings file');
  if (!existsSync(p)) throw new FindingsSourceError(`findings file not found: ${p}`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    throw new FindingsSourceError(`findings file is not valid JSON: ${p} (${(e as Error).message})`);
  }
  try {
    return parseFindings(raw);
  } catch (e) {
    throw new FindingsSourceError(`${p}: ${(e as Error).message}`);
  }
}
