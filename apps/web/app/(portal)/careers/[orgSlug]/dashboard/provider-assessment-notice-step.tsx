'use client';

import { useI18n } from '../../../../../lib/i18n';
import { atsNoticeAcknowledgment } from '../../../../../components/assessment-consent-notice';
import type { NoticeAcknowledgment } from '../../../../../lib/platform-api/assessment-provider-portal';
import { ProviderConsentGuide } from './provider-consent-guide';
import { noticeGuideItem } from './provider-notice-guide-item';

// Before a sitting that needs no provider consent any more (status "ready": the provider already holds every purpose),
// the candidate still reads the ATS notice for this vacancy (design §6.3), so no assessment ever starts without it. It is
// the consent guide with its one step (no "Paso 1 de 1", no review): the notice's title, "Leer el texto completo" and an
// unchecked "Leí este aviso.". "Comenzar" stays disabled until it is ticked, and hands back the acknowledgment (version
// and language) the launch records.
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
  const m = t.portalDashboard;
  return (
    <ProviderConsentGuide
      items={[noticeGuideItem(t, notice)]}
      finishLabel={m.providerStart}
      busy={busy}
      onFinish={() => onStart(atsNoticeAcknowledgment(locale))}
      onCancel={onCancel}
    />
  );
}
