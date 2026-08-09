import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { stripComments } from '../helpers/source-blocks';

// ── No new hollow static tripwires ────────────────────────────────────────────
//
// `SRC.slice(SRC.indexOf('name'))` runs to end-of-file, so an assertion "procedure X
// carries guard G" is satisfied by G appearing in ANY later procedure. #147 converted
// 43 such sites to `blockAt`, which bounds at the next sibling. Nothing stopped the
// idiom being written again — and it is still copy-pasteable from several plan docs
// under docs/, so it would come back.
//
// This is the class-level guard. It is deliberately narrow: it bans `.slice(` whose
// argument list contains `.indexOf(`, which is the exact shape, and nothing else. A
// control that cries wolf gets switched off.
//
// Scanned against COMMENT-STRIPPED source. Not optional: this repo has been bitten
// five times by source scans matching prose (the calibration tripwire's `\.\s*`,
// evaluation360, the console.log-in-a-comment tripwire, the §21 audit control that
// certified data-requests.ts on the strength of a comment, and the `blockAt` docblock
// below — which describes the banned idiom in prose and would otherwise fail this).

const TESTS_DIR = join(__dirname, '..');

/**
 * Files permitted to contain the banned idiom, each for a stated reason.
 * An allowlist entry is a claim that must stay true, so keep it specific.
 */
const ALLOWLIST = new Map<string, string>([
  [
    'helpers/source-blocks.test.ts',
    'demonstrates the defect side-by-side with the fix — the hollow form IS the fixture that proves blockAt bounds correctly',
  ],
]);

/**
 * Matches `.slice(` whose FIRST argument is derived from `.indexOf(` — i.e. the START
 * of the region is anchored on a found string. That is the dangerous shape, in both
 * its forms: one-argument (runs to end-of-file) and two-argument (degrades to the
 * one-argument form the day the end anchor is renamed, because `indexOf` returns -1
 * and `slice(n, -1)` means "to one char before the end").
 *
 * Requiring no comma between `.slice(` and `.indexOf(` is what confines it to the
 * first argument, and it matters — a first cut banned `.indexOf(` anywhere in the
 * call and flagged two innocents:
 *
 *   - `m[0].slice(1, -1)` in a file that merely mentions indexOf elsewhere;
 *   - `SRC.slice(0, SRC.indexOf('writeRepo'))` — a PREFIX slice, which fails SAFE:
 *     rename the anchor and the region widens to the whole file, so the negative
 *     assertion over it goes red rather than silently passing.
 *
 * Newlines are allowed between the two calls (the char class permits them), so the
 * Prettier-wrapped multi-line form is caught too — the form a line-anchored grep
 * misses, and which accounted for 2 of the sites #147 itself failed to count.
 */
const HOLLOW = /\.slice\(\s*[^,;]*?\.indexOf\(/;

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsFilesUnder(p));
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

describe('governance — no unbounded source-slicing tripwires', () => {
  const files = tsFilesUnder(TESTS_DIR);

  it('scans a non-empty population (non-vacuity)', () => {
    // A probe over zero files reads exactly like a clean sweep. Establish the
    // denominator before trusting the numerator.
    expect(files.length).toBeGreaterThan(200);
  });

  // NOTE: this title deliberately avoids spelling the banned call sequence. Writing it
  // out — even inside a string or a comment — makes this file match its own ban. It did,
  // on the first run. Same class as the `console.log`-in-a-comment tripwire.
  it('no test anchors the START of a source region on a found offset — use blockAt', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(TESTS_DIR, file);
      if (ALLOWLIST.has(rel)) continue;
      if (HOLLOW.test(stripComments(readFileSync(file, 'utf8')))) offenders.push(rel);
    }
    expect(
      offenders,
      `Use blockAt() from tests/helpers/source-blocks.ts instead — it bounds the block at the ` +
        `next sibling declaration. An unbounded slice runs to end-of-file, so the assertion is ` +
        `satisfied by any LATER procedure and stops protecting the one it names.\nOffenders:\n` +
        offenders.join('\n'),
    ).toEqual([]);
  });

  it('every allowlist entry still exists and still contains the idiom it is excused for', () => {
    // A stale allowlist entry silently widens the ban's hole.
    for (const [rel, reason] of ALLOWLIST) {
      const src = readFileSync(join(TESTS_DIR, rel), 'utf8');
      expect(HOLLOW.test(stripComments(src)), `${rel} no longer needs its allowlist entry (${reason})`).toBe(true);
    }
  });
});
