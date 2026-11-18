'use client';

import { useState } from 'react';
import { useI18n } from '../../../../../../lib/i18n';
import { PlatformApiError } from '../../../../../../lib/platform-api/client';
import {
  downloadProviderReport,
  useProviderReports,
} from '../../../../../../lib/platform-api/assessment-provider-reports';
import { toast } from '../../../../../../lib/toast';
import { Menu, buttonClasses, type MenuEntry } from '../../../../../../components';

/**
 * "PDF reports" on a result card: opens a short list of the reports TIMS offers for the result (the results report of a
 * native test, and each PCA report TIMS lists), loaded when it opens, and saves the one chosen. Shown to company-scope
 * readers only (the board draws a profile only for them); C# refuses anyone narrower (D6), and a 403 renders nothing.
 */
export function ProviderReportMenu({ attemptId, instrument }: { attemptId: string; instrument: string }) {
  const { t } = useI18n();
  const r = t.providerAssessments.results.reports;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const reports = useProviderReports(attemptId, open);

  if (reports.error instanceof PlatformApiError && reports.error.status === 403) return null;

  async function download(variant: string | null) {
    setBusy(true);
    try {
      await downloadProviderReport(attemptId, instrument, variant);
      toast(r.downloaded, { type: 'success' });
    } catch {
      toast(r.downloadError, { type: 'error' });
    } finally {
      setBusy(false);
    }
  }

  // The shared menu pattern (foundation §9): role=menu, arrow keys, Escape and outside click close and return focus.
  // The list loads when it opens; until then (or when it fails or is empty) one disabled row says why.
  const status = (key: string, label: string): MenuEntry[] => [{ key, label, disabled: true }];
  const items: MenuEntry[] = reports.isPending
    ? status('loading', r.loading)
    : reports.isError
      ? status('error', r.error)
      : !reports.data || reports.data.length === 0
        ? status('none', r.none)
        : reports.data.map((report) => ({
            key: report.variant ?? 'native',
            label: report.title ?? (report.variant === null ? r.native : report.variant),
            icon: <DownloadIcon />,
            disabled: busy,
            onSelect: () => void download(report.variant),
          }));

  return (
    <Menu
      items={items}
      label={r.button}
      onOpenChange={setOpen}
      panelClassName="w-64"
      triggerClassName={buttonClasses({ variant: 'secondary', size: 'sm' })}
      trigger={
        <>
          <span aria-live="polite">{busy ? r.downloading : r.button}</span>
          <svg
            className="size-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M19 9l-7 7-7-7" />
          </svg>
        </>
      }
    />
  );
}

function DownloadIcon() {
  return (
    <svg
      className="size-4 text-secondary"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14" />
    </svg>
  );
}
