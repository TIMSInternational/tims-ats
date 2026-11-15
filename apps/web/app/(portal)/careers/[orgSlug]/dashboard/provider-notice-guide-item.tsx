import type { useI18n } from '../../../../../lib/i18n';
import { AssessmentConsentNotice } from '../../../../../components/assessment-consent-notice';
import type { ConsentGuideItem } from './provider-consent-guide';

/** The notice's key in the consent guide: never a consent purpose, so it is never sent as one. */
export const NOTICE_STEP = 'ats-notice';

/**
 * The first step of every consent guide: the ATS's own notice for this vacancy, acknowledged with "Leí este aviso.".
 * Its full text is the versioned notice itself (AssessmentConsentNotice), word for word.
 */
export function noticeGuideItem(
  t: ReturnType<typeof useI18n>['t'],
  notice: { orgName: string; vacancyTitle: string; instrumentName: string },
): ConsentGuideItem {
  const m = t.portalDashboard;
  return {
    key: NOTICE_STEP,
    stepLabel: m.providerGuideStepNotice,
    title: t.assessmentConsentNotice.title,
    line: m.providerGuideNoticeLine,
    checkboxLabel: t.assessmentConsentNotice.readAck,
    checkedLabel: m.providerGuideRead,
    optional: false,
    fullText: (
      <AssessmentConsentNotice
        orgName={notice.orgName}
        vacancyTitle={notice.vacancyTitle}
        instruments={[notice.instrumentName]}
        titled={false}
      />
    ),
  };
}
