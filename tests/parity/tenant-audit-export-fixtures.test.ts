import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { z } from 'zod';

const findForExport = vi.hoisted(() => vi.fn());
vi.mock('../../packages/api/src/repositories/audit.repository', () => ({
  auditRepository: { findForExport },
}));
import { auditService } from '../../packages/api/src/services/audit.service';

const text = z.string().max(10000);
const fixture = z
  .object({
    cases: z
      .array(
        z.object({
          name: text,
          format: z.enum(['csv', 'json']),
          rows: z
            .array(
              z.object({
                createdAt: z.string().datetime(),
                actor: z.object({ firstName: text, lastName: text, email: text }).nullable(),
                action: text,
                entity: text,
                entityId: text.nullable(),
                ipAddress: text.nullable(),
                userAgent: text.nullable(),
              }),
            )
            .max(100),
          expected: z.object({
            data: text,
            count: z.number().int(),
            truncated: z.boolean(),
            format: z.enum(['csv', 'json']),
          }),
        }),
      )
      .max(100),
  })
  .parse(JSON.parse(readFileSync(join(__dirname, '../../contracts/audit-fixtures/tenant-export.json'), 'utf8')));

it.each(fixture.cases)('real TypeScript export service matches shared fixture: $name', async (testCase) => {
  findForExport.mockResolvedValue(testCase.rows.map((row) => ({ ...row, createdAt: new Date(row.createdAt) })));
  const result = await auditService.exportLogs('11111111-1111-1111-1111-111111111111', { format: testCase.format });
  expect(result).toEqual(testCase.expected);
  expect(findForExport).toHaveBeenLastCalledWith('11111111-1111-1111-1111-111111111111', {}, 10000);
});
