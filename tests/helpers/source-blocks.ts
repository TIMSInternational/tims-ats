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
 * sibling declaration, or the construct's own closing brace, whichever comes first.
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
 * mechanical rather than a matter of taste. A malformed or hand-indented file
 * degrades to a SHORTER block, never a longer one — the safe direction, because a
 * short block can only cause a false failure, never a false pass.
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
        // An unterminated literal must not swallow the rest of the file.
        if (c === closer || (mode === 'regex' && c === '\n')) {
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
 * A closing delimiter can never begin a sibling declaration, so skipping these cannot
 * widen a block past the next real sibling.
 */
function isContinuationLine(text: string, lineStart: number): boolean {
  const lineEnd = text.indexOf('\n', lineStart);
  const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd).trim();
  return /^[)\]},;.]/.test(line) || /^(else|catch|finally)\b/.test(line);
}

export interface BlockOptions {
  /**
   * Occurrence to anchor on, 1-based, when the anchor text appears more than once.
   * Defaults to the first. Passing this is preferable to lengthening the anchor
   * into something that duplicates the assertion.
   */
  occurrence?: number;
  /** Name used in the failure message. Defaults to the anchor itself. */
  label?: string;
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
  const { occurrence = 1, label = anchor } = opts;
  const code = stripComments(src);

  let start = -1;
  for (let n = 0; n < occurrence; n++) {
    start = code.indexOf(anchor, start + 1);
    if (start === -1) {
      throw new Error(
        `blockAt: anchor ${JSON.stringify(label)} not found` +
          (occurrence > 1 ? ` (occurrence ${occurrence})` : '') +
          ' in comment-stripped source. The tripwire is anchored on something that no longer exists.',
      );
    }
  }

  const lineStart = code.lastIndexOf('\n', start) + 1;
  const anchorIndent = indentOfLineAt(code, lineStart);

  // Scan forward line by line for the first non-blank line at or shallower than the
  // anchor's indentation — the next sibling, or this construct's own closing brace.
  let cursor = code.indexOf('\n', start);
  while (cursor !== -1) {
    const nextLineStart = cursor + 1;
    if (nextLineStart >= code.length) break;
    const indent = indentOfLineAt(code, nextLineStart);
    if (indent !== -1 && indent <= anchorIndent && !isContinuationLine(code, nextLineStart)) {
      return code.slice(start, nextLineStart);
    }
    cursor = code.indexOf('\n', nextLineStart);
  }

  // Anchor is the last construct in the file: end-of-file IS the correct bound,
  // because there is no later sibling whose code could satisfy the assertion.
  return code.slice(start);
}
