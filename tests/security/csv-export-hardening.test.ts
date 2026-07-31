/**
 * csv-export-hardening.test.ts
 *
 * Pins the shared CSV formula/row-injection defense (CWE-1236) and proves the
 * still-TS-served platform CSV export (the cross-org audit-log export) wires it in.
 * exportAuditLogsCsv previously escaped only commas, leaving a formula-injection gap
 * (an org/actor name starting with =/+/-/@ executes as a formula when an auditor
 * opens the export in Excel/Sheets) — fixed by reusing what was access-review's csvCell logic.
 *
 * access-review's OWN exportAccessReviewCsv (the original csvCell wiring this suite pinned)
 * was DELETED 2026-07-31 — NEXT_PUBLIC_ACCESS_REVIEW_READ_VIA_CSHARP confirmed live in prod, so
 * the C# read surface is the sole implementation now; see
 * packages/api/src/routers/platform/access-review.ts's header comment. The `csvCell`/`csvRow`
 * unit tests below are unaffected (they pin the shared helper directly, still used by
 * system.ts's audit-log export).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { csvCell, csvRow } from '../../packages/shared/src/csv';

describe('csvCell', () => {
  it('neutralizes a leading =/+/-/@/tab/CR so spreadsheets never execute it as a formula', () => {
    expect(csvCell('=cmd|/c calc')).toBe('"\'=cmd|/c calc"');
    expect(csvCell('+1')).toBe('"\'+1"');
    expect(csvCell('-1')).toBe('"\'-1"');
    expect(csvCell('@SUM(A1)')).toBe('"\'@SUM(A1)"');
  });

  it('double-quotes and escapes embedded quotes (RFC-4180)', () => {
    expect(csvCell('Jane "JJ" Doe')).toBe('"Jane ""JJ"" Doe"');
  });

  it('passes ordinary values through quoted, unmodified', () => {
    expect(csvCell('Acme Corp')).toBe('"Acme Corp"');
  });

  it('treats null/undefined as an empty cell', () => {
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
  });
});

describe('csvRow', () => {
  it('joins escaped cells with commas', () => {
    expect(csvRow(['a', '=evil', null])).toBe('"a","\'=evil",""');
  });
});

const ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('wiring — the still-TS-served platform CSV export uses the shared hardened helper', () => {
  it('the cross-org audit-log CSV export imports csvRow from @tims/shared', () => {
    const src = read('packages/api/src/routers/platform/system.ts');
    expect(src).toMatch(/import\s*\{\s*csvRow\s*\}\s*from\s*'@tims\/shared'/);
    expect(src).not.toMatch(/\.replace\(\/,\/g,\s*'\s*'\)/); // the old comma-only "escaping"
  });
});
