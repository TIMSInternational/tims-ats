import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * scripts/deploy/README-cutover.md carries a surface table that duplicates scripts/deploy/cutover.sh's
 * `surface_row` catalog, and the README's own header says it is "cross-checked directly against"
 * that script. Nothing checked it.
 *
 * On 2026-08-11 an adversarial review found FOUR rows disagreeing with the script — the worst being
 * `succession`, where the README advertised a `verify succession` command that the script AT THE
 * TIME set to NONE and that surfaces.ts then documented as a deliberate no-op (both reversed by the
 * 2026-08-17 #195 re-registration — `verify succession` is a real command again). A reader
 * following the README would have run a command that silently exits 0 having verified nothing,
 * which is precisely the class of failure .claude/rules/verification.md exists to prevent.
 *
 * This asserts the two stay in sync on the fields that change behaviour: the parity command a reader
 * would copy, and the status label they would act on. It is deliberately a STRING comparison against
 * the script's own catalog rather than a re-derivation, so the script stays the single source of
 * truth and the README is the thing required to follow it.
 */

const ROOT = join(__dirname, '..', '..');
const SCRIPT = readFileSync(join(ROOT, 'scripts/deploy/cutover.sh'), 'utf8');
const README = readFileSync(join(ROOT, 'scripts/deploy/README-cutover.md'), 'utf8');

interface ScriptRow {
  surface: string;
  parityCommand: string;
  parityKey: string;
  status: string;
}

/** Parses `surface_row`'s `case` arms: a `<name>)` label followed by `echo "kind|flag|pcmd|pkey|fe|status|note"`. */
function parseScriptRows(): ScriptRow[] {
  const rows: ScriptRow[] = [];
  const lines = SCRIPT.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const label = /^\s{4}([a-z0-9-]+)\)\s*$/.exec(lines[i]);
    if (!label) continue;
    const echo = /^\s*echo "([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|/.exec(lines[i + 1] ?? '');
    if (!echo) continue;
    rows.push({ surface: label[1], parityCommand: echo[3], parityKey: echo[4], status: echo[6] });
  }
  return rows;
}

/** Human-readable status label, mirroring cutover.sh's `status_label`. */
function statusLabel(status: string): string {
  switch (status) {
    case 'CONFIRMED_LIVE':
      return 'CONFIRMED LIVE';
    case 'FLIP_READY':
      return 'FLIP-READY';
    case 'TS_DELETED':
      return 'TS DELETED';
    default:
      return status;
  }
}

describe('cutover.sh <-> README-cutover.md surface table', () => {
  const rows = parseScriptRows();

  it('parses every surface the script defines — a broken parser must not silently pass', () => {
    // Non-vacuity floor. If the case-arm shape ever changes, this fails loudly instead of the
    // per-row assertions below iterating zero times and reporting green.
    const declared = /^ALL_SURFACES="(.+)"$/m.exec(SCRIPT)?.[1].split(' ') ?? [];
    expect(declared.length).toBeGreaterThan(0);
    expect(rows.map((r) => r.surface).sort()).toEqual([...declared].sort());
  });

  it.each(parseScriptRows().map((r) => [r.surface, r] as const))(
    'README row for %s matches the script',
    (surface, row) => {
      const line = README.split('\n').find((l) => l.startsWith(`| \`${surface}\``));
      expect(line, `no README table row for "${surface}"`).toBeDefined();

      // The parity command a reader would copy. NONE rows must NOT advertise a runnable command —
      // that was the succession defect.
      if (row.parityCommand === 'NONE') {
        expect(line, `${surface}: README advertises a parity command the script does not have`).not.toMatch(
          /\|\s*`verify(-write)? /,
        );
      } else {
        expect(line, `${surface}: README parity command disagrees with cutover.sh`).toContain(
          `\`${row.parityCommand} ${row.parityKey}\``,
        );
      }

      // The status a reader would act on.
      expect(
        line,
        `${surface}: README status disagrees with cutover.sh (expected "${statusLabel(row.status)}")`,
      ).toContain(statusLabel(row.status));
    },
  );
});
