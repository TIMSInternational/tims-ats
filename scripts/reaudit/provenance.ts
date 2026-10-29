/**
 * Evidence provenance: which commit, and which command, a report was produced from.
 *
 * The evidence-producing step (scripts/reaudit/record.ts) runs the canonical full-suite command
 * (canonical.ts) and, after it exits, writes a manifest next to the report: the exact argv it ran, the
 * git SHA the run started and ended at (the same, or no manifest is written), whether the checkout was
 * dirty (untracked files included), the run's exit status, the absolute checkout root, and a SHA-256 of
 * every report file. The collector accepts a report only when its manifest names the current HEAD, its
 * argv is the canonical command writing to this very evidence path, and every hash still matches; it
 * parses the exact bytes it hashed.
 *
 * File timestamps play no part. What this proves: the report bytes are the ones a recorded run wrote,
 * and that run was the canonical, unfiltered command and started and ended at the named commit. What it
 * does not prove: it is not a signature. Someone who hand-writes a manifest can lie in it (including the
 * argv); the manifest guards against stale, copied or filtered evidence, not against forgery.
 */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import { canonicalOutput } from './canonical';
import { z } from 'zod';
import { FULL_SHA_RE } from './git-state';

export type EvidenceKind = 'playwright' | 'vitest' | 'xunit';
export const EVIDENCE_KINDS: readonly EvidenceKind[] = ['playwright', 'vitest', 'xunit'];

export class ProvenanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProvenanceError';
  }
}

/** The TRX input is a directory of reports; the JSON inputs are single files. */
export const isDirKind = (kind: EvidenceKind): boolean => kind === 'xunit';
export const DIR_MANIFEST = 'reaudit-provenance.json';

export function manifestPathFor(output: string, kind: EvidenceKind): string {
  return isDirKind(kind) ? join(output, DIR_MANIFEST) : `${output}.provenance.json`;
}

const MAX_LISTED_DIRTY = 200;

const manifestSchema = z
  .object({
    /** 2: the manifest records the argv. Version-1 manifests (no argv) are refused: re-record. */
    version: z.literal(2),
    kind: z.enum(['playwright', 'vitest', 'xunit']),
    headSha: z.string().regex(FULL_SHA_RE),
    dirty: z.boolean(),
    dirtyPaths: z.array(z.string().min(1).max(4096)).max(MAX_LISTED_DIRTY),
    exitCode: z.number().int().min(0).max(255),
    /** The exact command record.ts ran; must be the canonical full-suite command (canonical.ts). */
    argv: z.array(z.string().max(4096)).min(1).max(64),
    /** Absolute toplevel of the checkout the run happened in: report paths are resolved against it. */
    checkoutRoot: z.string().min(1).max(4096).refine(isAbsolute, { message: 'checkoutRoot must be absolute' }),
    recordedAt: z.string().datetime(),
    files: z
      .array(z.object({ name: z.string().min(1).max(255), sha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict())
      .min(1)
      .max(1000),
  })
  .strict()
  .refine((m) => m.dirty === m.dirtyPaths.length > 0, { message: '"dirty" disagrees with "dirtyPaths"' });

export type ProvenanceManifest = z.infer<typeof manifestSchema>;

const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

/** Regular files directly in a TRX directory, the manifest excluded. A symlink is refused. */
function dirReportFiles(dir: string): string[] {
  const names: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (name === DIR_MANIFEST) continue;
    const st = lstatSync(join(dir, name));
    if (st.isSymbolicLink()) throw new ProvenanceError(`evidence must not be a symlink: ${join(dir, name)}`);
    if (st.isFile()) names.push(name);
  }
  return names;
}

function samePath(a: string, b: string): boolean {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}

function readRegularFile(p: string): Buffer {
  const st = lstatSync(p);
  if (st.isSymbolicLink() || !st.isFile()) throw new ProvenanceError(`evidence must be a regular file: ${p}`);
  return readFileSync(p);
}

export interface WriteProvenanceInput {
  kind: EvidenceKind;
  output: string;
  headSha: string;
  dirtyPaths: readonly string[];
  exitCode: number;
  /** Absolute toplevel of the checkout the run happened in. */
  checkoutRoot: string;
  /** The exact command that ran. */
  argv: readonly string[];
}

/** Hashes the report(s) at `output` and writes the manifest. Never overwrites an existing manifest. */
export function writeProvenance(input: WriteProvenanceInput): ProvenanceManifest {
  const { kind, output } = input;
  const names = isDirKind(kind) ? dirReportFiles(output) : [basename(output)];
  const base = isDirKind(kind) ? output : join(output, '..');
  if (names.length === 0) throw new ProvenanceError(`no report files in ${output}`);
  const manifest = manifestSchema.parse({
    version: 2,
    kind,
    headSha: input.headSha,
    dirty: input.dirtyPaths.length > 0,
    dirtyPaths: input.dirtyPaths.slice(0, MAX_LISTED_DIRTY),
    exitCode: input.exitCode,
    checkoutRoot: input.checkoutRoot,
    argv: [...input.argv],
    recordedAt: new Date().toISOString(),
    files: names.map((name) => ({ name, sha256: sha256(readRegularFile(join(base, name))) })),
  });
  writeFileSync(manifestPathFor(output, kind), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return manifest;
}

export interface VerifyProvenanceInput {
  kind: EvidenceKind;
  /** The report file (playwright, vitest) or TRX directory (xunit). */
  evidence: string;
  headSha: string;
  /** --gate launch: evidence produced from a dirty checkout is not evidence of HEAD. */
  requireClean: boolean;
}

export interface VerifiedEvidence {
  manifest: ProvenanceManifest;
  /** The verified bytes of each report file, by file name. Parse these, not a re-read of the file. */
  files: Map<string, Buffer>;
}

export function verifyProvenance(input: VerifyProvenanceInput): VerifiedEvidence {
  const { kind, evidence, headSha } = input;
  if (!FULL_SHA_RE.test(headSha)) throw new ProvenanceError(`cannot verify provenance: HEAD is "${headSha}"`);
  const mPath = manifestPathFor(evidence, kind);
  if (!existsSync(mPath)) {
    throw new ProvenanceError(
      `no provenance manifest for ${evidence} (expected ${mPath}): produce evidence with ` +
        `scripts/reaudit/record.ts so the tested commit is recorded`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readRegularFile(mPath).toString('utf8'));
  } catch (e) {
    throw new ProvenanceError(`provenance manifest is not valid JSON: ${mPath} (${(e as Error).message})`);
  }
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new ProvenanceError(
      `invalid provenance manifest ${mPath} (${first ? `${first.path.join('.') || '(root)'}: ${first.message}` : 'invalid'})`,
    );
  }
  const m = parsed.data;
  if (m.kind !== kind) throw new ProvenanceError(`${mPath} records a ${m.kind} run, not ${kind}: ${evidence}`);
  if (m.headSha !== headSha) {
    throw new ProvenanceError(
      `evidence was produced at ${m.headSha}, HEAD is ${headSha}, so it is not evidence of HEAD: ${evidence}`,
    );
  }
  const ranOutput = canonicalOutput(kind, m.argv);
  if (ranOutput === undefined) {
    throw new ProvenanceError(
      `${mPath} records a command that is not the canonical full-suite ${kind} run (a filtered or partial run ` +
        `cannot show that every bound check ran): ${JSON.stringify(m.argv)}`,
    );
  }
  if (ranOutput !== '' && !samePath(ranOutput, evidence)) {
    throw new ProvenanceError(`${mPath} records a run that wrote ${ranOutput}, not ${evidence}`);
  }
  if (input.requireClean && m.dirty) {
    throw new ProvenanceError(
      `evidence was produced from a checkout with uncommitted or untracked changes (${m.dirtyPaths.join(', ')}), ` +
        `so it is not evidence of HEAD: ${evidence}`,
    );
  }

  const base = isDirKind(kind) ? evidence : join(evidence, '..');
  if (!isDirKind(kind) && (m.files.length !== 1 || m.files[0]?.name !== basename(evidence))) {
    throw new ProvenanceError(`${mPath} does not describe ${evidence}`);
  }
  if (isDirKind(kind)) {
    const listed = new Set(m.files.map((f) => f.name));
    const unlisted = dirReportFiles(evidence).filter((n) => n.endsWith('.trx') && !listed.has(n));
    if (unlisted.length) {
      throw new ProvenanceError(
        `report files not written by the recorded run: ${unlisted.map((n) => join(evidence, n)).join(', ')}`,
      );
    }
  }
  const files = new Map<string, Buffer>();
  for (const f of m.files) {
    const p = join(base, f.name);
    if (!existsSync(p)) throw new ProvenanceError(`recorded report file is missing: ${p}`);
    const bytes = readRegularFile(p);
    if (sha256(bytes) !== f.sha256) {
      throw new ProvenanceError(`report file changed since it was recorded (SHA-256 mismatch): ${p}`);
    }
    files.set(f.name, bytes);
  }
  return { manifest: m, files };
}
