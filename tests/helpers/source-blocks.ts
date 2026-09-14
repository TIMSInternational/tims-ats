/**
 * Bounded, comment-free extraction of a named block from source, for static tripwires.
 *
 * ── Why this exists ───────────────────────────────────────────────────────────
 *
 * The idiom this replaces is `SRC.slice(SRC.indexOf('procedureName'))` — a slice with
 * no end bound, running to end-of-file. An assertion over such a slice does not prove
 * what its title claims: `expect(block).toMatch(/guard/)` proves only that SOME
 * occurrence of `guard` appears somewhere AFTER the anchor, not that the anchored
 * procedure carries it. Any later procedure in the same file satisfies it, so the
 * tripwire stays green after the guard is moved out of the thing it names.
 *
 * The two-argument form `slice(indexOf(A), indexOf(B))` is sounder but still brittle:
 * it silently degrades to the unbounded form when `B` is deleted, because `indexOf`
 * returns `-1` and `slice(n, -1)` means "to one character before the end".
 *
 * ── How the bound is derived ──────────────────────────────────────────────────
 *
 * By INDENTATION, not by a list of builder names. The block ends at the first later
 * non-blank line indented at or shallower than the anchor's own line — i.e. the next
 * sibling declaration, or end-of-file if the anchor is the last construct.
 *
 * It never stops AT a closing brace: a pure closer (`}`, `});`, `}),`) is a
 * continuation, so the block includes its own closing brace and runs to the next
 * sibling. An earlier version of this docblock said "or the construct's own closing
 * brace, whichever comes first", which was simply false — flagged by an adversarial
 * review lens. The extra trailing closer is harmless (it carries no assertable code);
 * what matters is that no LATER sibling's body is included.
 *
 * Indentation generalises across every shape these tripwires actually anchor on,
 * which a procedure-name pattern does not:
 *
 *   - tRPC procedures      `schedule: permissionProcedure('interview', 'create')`
 *   - class/service methods `async submitAssessment(...) {`
 *   - top-level declarations `const withSecurityAudit = t.middleware(...)`
 *   - inner blocks          `if (question.type === 'free_text') {`
 *
 * It is reliable here because the repo is Prettier-formatted, so indentation is
 * mechanical rather than a matter of taste.
 *
 * ⚠️ The safety property is CONDITIONAL on that, and the conditional half is the
 * dangerous one. Within a consistently-indented file an anomaly yields a SHORTER
 * block, which can only cause a false failure. But if indentation UNITS are mixed —
 * a tab-indented anchor (width 1) followed by a space-indented sibling (width 2) —
 * the sibling never compares `<=` and the block runs past it, which is a false PASS.
 * An earlier version of this docblock asserted the safe direction unconditionally;
 * that was wrong, and an adversarial review lens demonstrated the counterexample.
 * Prettier prevents it in practice, so this is stated rather than defended in code.
 *
 * ── Comments are stripped ─────────────────────────────────────────────────────
 *
 * Returned blocks have comments blanked, so a prose mention cannot satisfy a gate.
 * This repo has been bitten by prose-matching four separate times (the calibration
 * tripwire's `\.\s*`, evaluation360, the `console.log`-in-a-comment tripwire, and the
 * §21 audit control that certified `data-requests.ts` on the strength of a comment
 * explaining why it does NOT call the helper). Anchors are searched against the same
 * comment-stripped text, so an anchor named only in prose does not resolve either.
 *
 * String CONTENTS are preserved — assertions here legitimately match on literals such
 * as `permissionProcedure('interview', 'create')`.
 */

/**
 * Blanks comment bodies, preserving every offset and newline so the result indexes
 * identically to the input.
 *
 * Tracks string, template and regex literals only so that `//` and other comment
 * openers appearing INSIDE them are not mistaken for comments — e.g. the `//` in a
 * URL literal. Regex detection uses the standard "previous significant token"
 * heuristic; a false negative there can only mis-blank a comment-looking sequence
 * inside a regex, which would shrink a block rather than widen it.
 */
export function stripComments(src: string): string {
  const out = src.split('');
  type Mode = 'code' | 'line' | 'block' | 'single' | 'double' | 'template' | 'regex';
  let mode: Mode = 'code';
  // The last non-whitespace character of real code, used to decide whether a `/`
  // opens a regex literal or is a division operator.
  let prev = '';

  const blank = (i: number) => {
    if (out[i] !== '\n') out[i] = ' ';
  };

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const next = src[i + 1];

    switch (mode) {
      case 'code':
        if (c === '/' && next === '/') {
          mode = 'line';
          blank(i);
          blank(i + 1);
          i++;
        } else if (c === '/' && next === '*') {
          mode = 'block';
          blank(i);
          blank(i + 1);
          i++;
        } else if (c === "'") mode = 'single';
        else if (c === '"') mode = 'double';
        else if (c === '`') mode = 'template';
        else if (c === '/' && /[(,=:[!&|?{};+\-*%<>~^]|^$/.test(prev)) mode = 'regex';
        if (mode === 'code' && !/\s/.test(c)) prev = c;
        break;

      case 'line':
        if (c === '\n') mode = 'code';
        else blank(i);
        break;

      case 'block':
        blank(i);
        if (c === '*' && next === '/') {
          blank(i + 1);
          i++;
          mode = 'code';
        }
        break;

      case 'single':
      case 'double':
      case 'template':
      case 'regex': {
        if (c === '\\') {
          i++; // skip the escaped character
          break;
        }
        const closer = mode === 'single' ? "'" : mode === 'double' ? '"' : mode === 'template' ? '`' : '/';
        // An unterminated literal must not swallow the rest of the file. Only a
        // TEMPLATE literal may legally span lines, so every other mode also ends at a
        // newline. Without this a bare apostrophe in JSX text (`don't`) opens a phantom
        // string that stays open until the next quote ANYWHERE later in the file, and
        // every `//` comment in between survives un-blanked — resurrecting exactly the
        // prose-satisfies-a-gate class this helper exists to prevent. Found by an
        // adversarial review lens, not by reasoning.
        if (c === closer || (mode !== 'template' && c === '\n')) {
          mode = 'code';
          prev = c;
        }
        break;
      }
    }
  }

  return out.join('');
}

/** Indentation width of the line containing `index`, or -1 for a blank line. */
function indentOfLineAt(text: string, lineStart: number): number {
  const lineEnd = text.indexOf('\n', lineStart);
  const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
  if (line.trim() === '') return -1;
  return line.length - line.trimStart().length;
}

/**
 * True for a line that CONTINUES or CLOSES the current construct rather than starting
 * a sibling — so it must not end the block even though it sits at the anchor's own
 * indentation.
 *
 * Needed because Prettier wraps a long signature with the closing paren back at the
 * declaration's indent:
 *
 *     async getDashboardKpis(
 *       orgId: string,
 *       appScopeWhere: Prisma.ApplicationWhereInput,
 *     ) {                     // <- same indent as `async getDashboardKpis(`
 *
 * Without this, the block is cut off at `) {` and contains only the signature. That is
 * a false-FAILURE rather than a false-pass, but it makes the helper unusable on the
 * many real methods formatted this way. Caught by running against the real
 * `candidate.repository.ts`, not by reasoning — the first fixtures here all used
 * single-line signatures, which is a shape this repo frequently does not produce.
 *
 * The test is deliberately "closers ONLY". An earlier version matched any line STARTING
 * with a closing delimiter, plus `else`/`catch`/`finally`, and that was wrong twice over
 * — both caught by an adversarial review lens, both re-introducing the hollowness this
 * helper removes:
 *
 *   - `...(cond ? { a } : {})` — a SPREAD SIBLING — starts with `.`, so it read as a
 *     continuation and the block ran straight past it. 119 such sites exist in
 *     packages/api/src, and it is the shape the repo uses for field-level authorization
 *     (e.g. compensation.service.ts:66-76). Hence `.` counts only when it is a chained
 *     call (`.input(`), never when it opens a spread.
 *   - `} else {` starts with `}` but OPENS a new block; treating it as a continuation
 *     made an `if`-block swallow its own `else`, so a guard asserted on the `if` branch
 *     could be satisfied by the `else` branch.
 *
 * So: a line is a continuation only if, after its leading closers, nothing remains (a
 * pure closer such as `}`, `}),`, `});`) or what remains opens the construct's body
 * (`) {`). Anything with an identifier or keyword after the closers begins something
 * new and must end the block.
 */
function isContinuationLine(text: string, lineStart: number): boolean {
  const lineEnd = text.indexOf('\n', lineStart);
  const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd).trim();
  const rest = line.replace(/^[)\]}\s,;]+/, '');
  if (rest === '' || rest.startsWith('{')) return true;
  // A chained builder continuation (`.input(`, `.mutation(`) — but NOT a spread.
  return rest.startsWith('.') && !rest.startsWith('...');
}

export interface BlockOptions {
  /**
   * Occurrence to anchor on, 1-based, among NON-IMPORT occurrences (see below).
   * Defaults to the first. Passing this is preferable to lengthening the anchor
   * into something that duplicates the assertion.
   */
  occurrence?: number;
  /** Name used in the failure message. Defaults to the anchor itself. */
  label?: string;
  /**
   * Minimum number of lines the resolved block must span, for call sites whose
   * assertions are NEGATIVE (`.not.toMatch`). A negative assertion over an
   * accidentally tiny block passes vacuously and silently stops protecting —
   * the same failure class this helper exists to remove, one layer up.
   */
  minLines?: number;
}

/** True if the line containing `index` is an import/re-export statement. */
function isImportLine(code: string, lineStart: number): boolean {
  const lineEnd = code.indexOf('\n', lineStart);
  const line = code.slice(lineStart, lineEnd === -1 ? code.length : lineEnd);
  return /^\s*(import|export)\b/.test(line) && /\bfrom\s*['"]/.test(line);
}

/**
 * Returns the comment-stripped source of the block introduced by `anchor`, bounded at
 * the next sibling declaration (see the module docblock).
 *
 * Throws — rather than returning the whole file, or an empty string — when the anchor
 * is absent. A tripwire whose anchor has been renamed away must fail loudly; silently
 * asserting over nothing is the failure mode this helper exists to remove.
 */
export function blockAt(src: string, anchor: string, opts: BlockOptions = {}): string {
  const { occurrence = 1, label = anchor, minLines } = opts;
  const code = stripComments(src);

  // Import/re-export lines are skipped, not counted. Two reasons, both real:
  //   - A realistic refactor ("extract `candidateQuestionSelect` to a shared module")
  //     turns the first textual occurrence into an IMPORT SPECIFIER. `blockAt` would
  //     then happily return `candidateQuestionSelect } from './selects';` and every
  //     `.not.toContain(...)` over it would pass vacuously, green, forever.
  //   - It removes the off-by-one where occurrence 1 of a builder name is its import.
  let start = -1;
  let found = 0;
  while (found < occurrence) {
    start = code.indexOf(anchor, start + 1);
    if (start === -1) {
      throw new Error(
        `blockAt: anchor ${JSON.stringify(label)} not found` +
          (occurrence > 1 ? ` (non-import occurrence ${occurrence})` : '') +
          ' in comment-stripped source. The tripwire is anchored on something that no longer exists.',
      );
    }
    if (!isImportLine(code, code.lastIndexOf('\n', start) + 1)) found++;
  }

  const lineStart = code.lastIndexOf('\n', start) + 1;
  const anchorIndent = indentOfLineAt(code, lineStart);

  const checked = (block: string): string => {
    if (minLines !== undefined) {
      const lines = block.split('\n').filter((l) => l.trim() !== '').length;
      if (lines < minLines) {
        throw new Error(
          `blockAt: block for ${JSON.stringify(label)} is ${lines} line(s), below the required ` +
            `minLines=${minLines}. A negative assertion over a block this small would pass vacuously.`,
        );
      }
    }
    return block;
  };

  // Scan forward line by line for the first non-blank line at or shallower than the
  // anchor's indentation — the next sibling declaration, or EOF. Never a closing brace.
  let cursor = code.indexOf('\n', start);
  while (cursor !== -1) {
    const nextLineStart = cursor + 1;
    if (nextLineStart >= code.length) break;
    const indent = indentOfLineAt(code, nextLineStart);
    if (indent !== -1 && indent <= anchorIndent && !isContinuationLine(code, nextLineStart)) {
      return checked(code.slice(start, nextLineStart));
    }
    cursor = code.indexOf('\n', nextLineStart);
  }

  // Anchor is the last construct in the file: end-of-file IS the correct bound,
  // because there is no later sibling whose code could satisfy the assertion.
  return checked(code.slice(start));
}
