import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { csvRow } from '../../packages/shared/src/csv';

const ROOT = join(__dirname, '..', '..');
const fixture = (p: string) => JSON.parse(readFileSync(join(ROOT, 'contracts/audit-fixtures', p), 'utf8'));

describe('cross-org-audit-logs fixture', () => {
  it('pins the list shape: logs[], nextCursor, total', () => {
    const f = fixture('cross-org-audit-logs.json');
    expect(f).toHaveProperty('logs');
    expect(f).toHaveProperty('nextCursor');
    expect(f).toHaveProperty('total');
    expect(Array.isArray(f.logs)).toBe(true);
    // auditLogSelect shape (system.helpers.ts): includes nested actor join { id, firstName, lastName, email, avatar }
    const row = f.logs[0];
    expect(Object.keys(row).sort()).toEqual(
      ['action', 'actor', 'createdAt', 'entity', 'entityId', 'id', 'ipAddress', 'metadata', 'userId'].sort(),
    );
  });
});

describe('export-audit-logs-csv fixture', () => {
  it('pins the CSV header + a formula-injection row, byte-for-byte via csvRow', () => {
    const f = fixture('export-audit-logs-csv.json');
    const header = csvRow(['Fecha', 'Organizacion', 'Actor', 'Accion', 'Entidad', 'ID Entidad', 'IP']);
    expect(f.header).toBe(header);
    // an org named "=cmd|' /c calc'!A0" must neutralize, matching csvRow exactly
    const row = csvRow([
      f.sample.createdAt,
      f.sample.organizationName,
      f.sample.actorName,
      f.sample.action,
      f.sample.entity,
      f.sample.entityId,
      f.sample.ip,
    ]);
    expect(row).toBe(f.expectedCsvRow);
    expect(row).toContain("'="); // the neutralization prefix survived quoting
  });
});
