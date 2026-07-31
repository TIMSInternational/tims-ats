/**
 * csv-export-hardening.test.ts
 *
 * Pins the shared CSV formula/row-injection defense (CWE-1236) and proves the remaining
 * TS platform CSV export (access-review) wires it in. The cross-org audit-log export
 * (`platform.exportAuditLogsCsv`) that originally motivated this fix — it escaped only commas,
 * leaving a formula-injection gap where an org/actor name starting with =/+/-/@ executes as a
 * formula when an auditor opens the export in Excel/Sheets — has since been deleted outright
 * (TS-deletion, 2026-07-31): NEXT_PUBLIC_AUDIT_LOG_READ_VIA_CSHARP is confirmed live in prod and
 * the C# `/audit/logs/export` endpoint is the sole implementation now (see
 * apps/web/lib/platform-api/audit-log.ts). `csvRow`'s own neutralization behavior (below) still
 * pins the fix at the shared-helper level regardless of which callers remain.
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

describe('wiring — the remaining TS platform CSV export uses the shared hardened helper', () => {
  it('access-review CSV export imports csvCell from @tims/shared', () => {
    const src = read('packages/api/src/routers/platform/access-review.ts');
    expect(src).toMatch(/import\s*\{\s*csvCell\s*\}\s*from\s*'@tims\/shared'/);
  });
});
