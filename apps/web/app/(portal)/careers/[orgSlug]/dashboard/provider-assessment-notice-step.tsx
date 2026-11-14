'use client';

import { useState } from 'react';
import { useI18n } from '../../../../../lib/i18n';
import { AssessmentConsentNotice, atsNoticeAcknowledgment } from '../../../../../components/assessment-consent-notice';
import type { NoticeAcknowledgment } from '../../../../../lib/platform-api/assessment-provider-portal';
import { BUTTON_GROUP_CLASSES, Button, CHOICE_INPUT_CLASSES } from '../../../../../components';

// Before a sitting that needs no provider consent any more (status "ready": the provider already holds every purpose),
// the candidate still reads the ATS notice for this vacancy (design §6.3), so no assessment ever starts without it.
// "Start" stays disabled until the notice is marked read, and hands back the acknowledgment (version and language) the
// launch records.
export function ProviderAssessmentNoticeStep({
  notice,
  busy,
  onStart,
  onCancel,
}: {
  notice: { orgName: string; vacancyTitle: string; instrumentName: string };
  busy: boolean;
  onStart: (notice: NoticeAcknowledgment) => void;
  onCancel: () => void;
}) {
  const { t, locale } = useI18n();
  const [read, setRead] = useState(false);
  return (
    <div className="mt-3 space-y-3">
      <AssessmentConsentNotice
        orgName={notice.orgName}
        vacancyTitle={notice.vacancyTitle}
        instruments={[notice.instrumentName]}
        scroll={false}
      >
        <label className="mt-1 flex min-h-7 cursor-pointer items-start gap-2 border-t border-border pt-3 text-body font-medium text-primary pointer-coarse:min-h-11">
          <input
            type="checkbox"
            checked={read}
            onChange={(event) => setRead(event.target.checked)}
            className={`${CHOICE_INPUT_CLASSES} mt-0.5`}
          />
          <span>{t.assessmentConsentNotice.readAck}</span>
        </label>
      </AssessmentConsentNotice>
      <div className={BUTTON_GROUP_CLASSES}>
        <Button variant="secondary" size="lg" onClick={onCancel} disabled={busy}>
          {t.portalDashboard.providerCancel}
        </Button>
        <Button
          size="lg"
          disabled={!read}
          loading={busy}
          loadingLabel={t.portalDashboard.providerOpening}
          onClick={() => onStart(atsNoticeAcknowledgment(locale))}
        >
          {t.portalDashboard.providerStart}
        </Button>
      </div>
    </div>
  );
}
