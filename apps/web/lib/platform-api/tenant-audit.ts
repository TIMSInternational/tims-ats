'use client';

import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { trpc } from '../trpc';
import { isPlatformApiEnabled, platformPost } from './client';

const VIA_CSHARP = process.env.NEXT_PUBLIC_TENANT_AUDIT_VIA_CSHARP === 'true';

const exportInput = z
  .object({
    format: z.enum(['csv', 'json']),
    dateFrom: z.date().optional(),
    dateTo: z.date().optional(),
    actorId: z.string().uuid().optional(),
    entity: z.string().max(200).optional(),
    action: z.string().max(200).optional(),
  })
  .strict();

const exportOutput = z
  .object({
    data: z.string().max(50_000_000),
    count: z.union([z.number(), z.string().regex(/^\d+$/).transform(Number)]).pipe(z.number().int().min(0).max(10_000)),
    truncated: z.boolean(),
    format: z.enum(['csv', 'json']),
  })
  .strict();

export type TenantAuditExportInput = z.infer<typeof exportInput>;

/** Uses one backend per click. A C# failure must never replay an audited export against tRPC. */
export function useTenantAuditExport() {
  const legacy = trpc.audit.exportLogs.useMutation();
  return useMutation({
    retry: false,
    mutationFn: async (input: TenantAuditExportInput) => {
      const validated = exportInput.parse(input);
      const raw =
        VIA_CSHARP && isPlatformApiEnabled()
          ? await platformPost('/tenant-audit/export', {
              ...validated,
              dateFrom: validated.dateFrom?.toISOString(),
              dateTo: validated.dateTo?.toISOString(),
            })
          : await legacy.mutateAsync(validated);
      const result = exportOutput.parse(raw);
      if (result.format !== validated.format) throw new Error('Unexpected audit export format');
      return result;
    },
  });
}
