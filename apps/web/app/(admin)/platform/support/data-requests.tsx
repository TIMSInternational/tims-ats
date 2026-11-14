'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { Button, Field, TextInput } from '../../../../components';

export function DataRequests() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [exporting, setExporting] = useState(false);
  const utils = trpc.useUtils();

  const handleExport = async (e: React.FormEvent) => {
    e.preventDefault();
    const subject = email.trim();
    if (!subject || !subject.includes('@')) return;
    setExporting(true);
    try {
      // staleTime/gcTime 0 is REQUIRED, not a tuning choice. The QueryClient default
      // is `staleTime: 300_000` (trpc-provider.tsx), and `utils.*.fetch` is
      // `queryClient.fetchQuery` — which serves a fresh cache entry with NO server
      // round-trip. Exporting the same subject twice inside 5 minutes would then
      // re-download the full PII bundle (salary, DOB, demographics) while writing
      // ZERO `data_access_logs` and ZERO `audit_logs` rows, because the procedure
      // never runs. Every export of this bundle must reach the server and be audited.
      const result = await utils.platform.exportSubjectData.fetch({ email: subject }, { staleTime: 0, gcTime: 0 });
      const blob = new Blob([result.json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `habeas-data-${subject}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      const total = Object.values(result.counts).reduce((s, n) => s + n, 0);
      toast(`${t.support.dataExportDone}: ${total}`, { type: 'success' });
    } catch (err) {
      // Only surface our own NOT_FOUND copy; for any other error show a generic
      // message so raw tRPC/Prisma internals never reach the browser.
      const code = (err as { data?: { code?: string } })?.data?.code;
      const message = code === 'NOT_FOUND' && err instanceof Error ? err.message : t.support.dataExportError;
      toast(message, { type: 'error' });
    } finally {
      setExporting(false);
    }
  };

  return (
    <section aria-labelledby="data-requests-title" className="rounded-xl bg-white p-5 shadow-card">
      <h2 id="data-requests-title" className="mb-3 text-heading font-semibold text-brand">
        {t.support.dataRequests}
      </h2>

      <form onSubmit={handleExport} className="rounded-lg border border-border p-4">
        <Field label={t.support.dataExportLabel} help={t.support.dataExportDesc}>
          {(control) => (
            <div className="flex flex-col gap-2 sm:flex-row">
              <TextInput
                {...control}
                type="email"
                autoComplete="off"
                placeholder={t.support.dataExportPlaceholder}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="min-w-0 flex-1"
              />
              <Button
                type="submit"
                variant="secondary"
                disabled={!email.trim()}
                loading={exporting}
                loadingLabel={t.support.dataExporting}
                className="shrink-0"
              >
                {t.support.dataExportButton}
              </Button>
            </div>
          )}
        </Field>
      </form>

      <p className="mt-3 text-callout text-secondary">{t.support.dataDeletionNote}</p>
    </section>
  );
}
