'use client';

import { useId, useState } from 'react';
import { useI18n } from '../../../../../../lib/i18n';
import { PlatformApiError } from '../../../../../../lib/platform-api/client';
import {
  downloadProviderReport,
  useProviderReports,
} from '../../../../../../lib/platform-api/assessment-provider-reports';
import { toast } from '../../../../../../lib/toast';

/**
 * "PDF reports" on a result card: opens a short list of the reports TIMS offers for the result (the results report of a
 * native test, and each PCA report TIMS lists), loaded when it opens, and saves the one chosen. Shown to company-scope
 * readers only (the board draws a profile only for them); C# refuses anyone narrower (D6), and a 403 renders nothing.
 */
export function ProviderReportMenu({ attemptId, instrument }: { attemptId: string; instrument: string }) {
  const { t } = useI18n();
  const r = t.providerAssessments.results.reports;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const panelId = useId();
  const reports = useProviderReports(attemptId, open);

  if (reports.error instanceof PlatformApiError && reports.error.status === 403) return null;

  async function download(variant: string | null) {
    const key = variant ?? 'native';
    setBusy(key);
    try {
      await downloadProviderReport(attemptId, instrument, variant);
      setOpen(false);
    } catch {
      toast(r.downloadError, { type: 'error' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="rounded-lg border border-[#DADADA] px-3 py-1.5 text-[13px] font-medium text-[#1F114C] hover:bg-[#F6F5FA] focus-visible:outline-2 focus-visible:outline-[#1F114C]"
      >
        {r.button}
      </button>
      {open && (
        <div
          id={panelId}
          onKeyDown={(event) => event.key === 'Escape' && setOpen(false)}
          className="absolute right-0 z-10 mt-1 w-64 rounded-lg border border-[#EDEDED] bg-white p-1 shadow-[0_4px_12px_rgba(0,0,0,0.08)]"
        >
          {reports.isPending && <p className="px-3 py-2 text-[13px] text-[#6B6B6B]">{r.loading}</p>}
          {reports.isError && <p className="px-3 py-2 text-[13px] text-red-700">{r.error}</p>}
          {reports.data?.length === 0 && <p className="px-3 py-2 text-[13px] text-[#6B6B6B]">{r.none}</p>}
          {reports.data && reports.data.length > 0 && (
            <ul className="max-h-72 overflow-y-auto">
              {reports.data.map((report) => {
                const key = report.variant ?? 'native';
                return (
                  <li key={key}>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void download(report.variant)}
                      className="w-full rounded-md px-3 py-2 text-left text-[13px] text-[#1F114C] hover:bg-[#F6F5FA] disabled:opacity-60"
                    >
                      {busy === key
                        ? r.downloading
                        : (report.title ?? (report.variant === null ? r.native : report.variant))}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
