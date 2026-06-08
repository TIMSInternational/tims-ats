'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';

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
      const result = await utils.platform.exportSubjectData.fetch({ email: subject });
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
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
      <h3 className="text-sm font-semibold text-[#333] mb-3 flex items-center gap-2">
        <svg className="w-4 h-4 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
          <path d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
        </svg>
        {t.support.dataRequests}
      </h3>

      <form onSubmit={handleExport} className="border border-[#EDEDED] rounded-lg p-4">
        <label className="text-xs text-[#8B8B8B] font-medium mb-2 block">{t.support.dataExportLabel}</label>
        <div className="flex gap-2">
          <input
            type="email"
            placeholder={t.support.dataExportPlaceholder}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="flex-1 border border-[#EDEDED] rounded-lg px-3 py-2 text-sm placeholder:text-[#ABABAB] focus:outline-none focus:ring-1 focus:ring-[#1F114C]/20"
          />
          <button
            type="submit"
            disabled={exporting || !email.trim()}
            className="px-3 py-2 bg-[#1F114C] text-white rounded-lg text-sm font-medium hover:bg-[#2a1866] whitespace-nowrap disabled:opacity-50"
          >
            {exporting ? t.support.dataExporting : t.support.dataExportButton}
          </button>
        </div>
        <p className="text-[11px] text-[#ABABAB] mt-2">{t.support.dataExportDesc}</p>
      </form>

      <p className="text-[11px] text-[#ABABAB] mt-3">{t.support.dataDeletionNote}</p>
    </div>
  );
}
