'use client';

import { useI18n } from '../../../../lib/i18n';

const NOTICE = 'px-4 md:px-6 py-2 border-b text-callout shrink-0';

/** One-line notices under the filter bar: a requested vacancy that could not open, and the read-only views. */
export function PipelineNotices({ unavailable, readOnly }: { unavailable: boolean; readOnly: boolean }) {
  const { t } = useI18n();
  return (
    <>
      {unavailable && (
        <div role="status" className={`${NOTICE} bg-warning-bg border-warning/30 text-warning`}>
          {t.pipeline.requestedVacancyUnavailable}
        </div>
      )}
      {readOnly && (
        <div role="status" className={`${NOTICE} bg-surface border-border text-secondary`}>
          {t.pipeline.readOnlyNotice}
        </div>
      )}
    </>
  );
}
