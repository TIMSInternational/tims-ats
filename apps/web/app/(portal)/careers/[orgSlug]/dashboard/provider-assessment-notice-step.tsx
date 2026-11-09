'use client';

import { useState } from 'react';
import { useI18n } from '../../../../../lib/i18n';
import { AssessmentConsentNotice } from '../../../../../components/assessment-consent-notice';

// Before a sitting that needs no provider consent any more (status "ready": the provider already holds every purpose),
// the candidate still reads the organization's notice for this vacancy (design §6.3; D22: a draft pending counsel), so
// no assessment ever starts without it. "Start" stays disabled until the notice is marked read.
export function ProviderAssessmentNoticeStep({
  notice,
  busy,
  onStart,
  onCancel,
}: {
  notice: { orgName: string; vacancyTitle: string; instrumentName: string };
  busy: boolean;
  onStart: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [read, setRead] = useState(false);
  return (
    <div className="mt-3 space-y-3">
      <AssessmentConsentNotice
        orgName={notice.orgName}
        vacancyTitle={notice.vacancyTitle}
        instruments={[notice.instrumentName]}
      />
      <label className="flex items-start gap-2 text-[12px] text-[#1F114C]">
        <input type="checkbox" checked={read} onChange={(event) => setRead(event.target.checked)} />
        <span>{t.assessmentConsentNotice.readAck}</span>
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!read || busy}
          onClick={onStart}
          className="inline-flex h-9 items-center rounded-xl bg-[#1F114C] px-4 text-[12px] font-semibold text-white hover:bg-[#2a1a5e] transition disabled:opacity-50"
        >
          {busy ? t.portalDashboard.providerOpening : t.portalDashboard.providerStart}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="inline-flex h-9 items-center rounded-xl border border-[#EDEDED] px-4 text-[12px] font-medium text-[#1F114C]"
        >
          {t.portalDashboard.providerCancel}
        </button>
      </div>
    </div>
  );
}
