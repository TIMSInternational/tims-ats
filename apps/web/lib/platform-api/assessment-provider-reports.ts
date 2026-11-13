'use client';

import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { platformGet, platformGetBlob } from './client';

/** The contract's report `variant` pattern; null = the provider's own interpretive report of a native test. */
const reportSchema = z
  .object({
    variant: z
      .string()
      .regex(/^[a-z0-9_]{1,64}$/)
      .nullable(),
    title: z.string().max(200).nullable(),
  })
  .strict();

const reportsSchema = z.object({ reports: z.array(reportSchema).max(64) }).strict();

export type ProviderReportOption = z.infer<typeof reportSchema>;

const REPORTS_PATH = '/assessments/provider-attempts/{attemptId}/reports' as const;
const REPORT_PATH = '/assessments/provider-attempts/{attemptId}/report';

export const providerReportsKey = (attemptId: string) => ['platform', 'provider-reports', attemptId] as const;

/**
 * GET /assessments/provider-attempts/{id}/reports — the PDF reports the attempt's latest result offers (company scope
 * only: C# answers 403 below it, D6). Loaded on demand, when the menu opens.
 */
export function useProviderReports(attemptId: string, enabled: boolean) {
  return useQuery({
    queryKey: providerReportsKey(attemptId),
    enabled,
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ProviderReportOption[]> =>
      reportsSchema.parse(await platformGet(REPORTS_PATH, undefined, { attemptId })).reports,
  });
}

/** The saved file's name: the test, and the provider report variant when there is one. */
export function reportFileName(instrument: string, variant: string | null): string {
  const safe = (value: string) => value.replace(/[^a-z0-9_-]/gi, '');
  return `tims-${safe(instrument)}${variant ? `-${safe(variant)}` : ''}.pdf`;
}

/** Downloads one report through the authenticated relay and saves it under {@link reportFileName}. */
export async function downloadProviderReport(attemptId: string, instrument: string, variant: string | null): Promise<void> {
  const blob = await platformGetBlob(REPORT_PATH, variant ? { variant } : undefined, { attemptId });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = reportFileName(instrument, variant);
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}
