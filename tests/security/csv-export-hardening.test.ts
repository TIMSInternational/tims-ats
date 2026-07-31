/**
 * csv-export-hardening.test.ts
 *
 * Pins the shared CSV formula/row-injection defense (CWE-1236) — originally added because
 * exportAuditLogsCsv escaped only commas, leaving a formula-injection gap (an org/actor name
 * starting with =/+/-/@ executes as a formula when an auditor opens the export in
 * Excel/Sheets) — fixed by introducing the shared `csvCell`/`csvRow` helpers and wiring both
 * TS platform CSV exports (access-review, audit-log) through them.
 *
 * Both original callers are now gone (TS-deletion, 2026-07-31): access-review's
 * exportAccessReviewCsv and audit-log's exportAuditLogsCsv were both deleted once their
 * respective NEXT_PUBLIC_*_VIA_CSHARP flags were confirmed live in prod — the C# endpoints
 * (`/access-review/export`, `/audit/logs/export`) are the sole implementations now. There is no
 * TS platform CSV export left to wire-test. The `csvCell`/`csvRow` unit tests below remain the
 * pin for the shared helper's neutralization behavior — still load-bearing for any future TS
 * CSV export (e.g. the untouched DSAR/data-requests export, which uses its own logic, not this
 * one).
 */
import { describe, it, expect } from 'vitest';
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
