'use client';

import { useI18n } from '../../../../lib/i18n';
import { PageHeader } from '../../../../components/page-header';
import { Button } from '../../../../components/button';

interface InterviewsPageHeaderProps {
  /** Omitted when the viewer may not schedule (committee-only, or no candidate/vacancy read): no button. */
  onSchedule?: () => void;
}

/** The page's h1 and its one primary action, trailing (toolbars.md › Titles, buttons.md › Style). */
export function InterviewsPageHeader({ onSchedule }: InterviewsPageHeaderProps) {
  const { t } = useI18n();
  return (
    <PageHeader
      title={t.interviews.title}
      description={t.interviews.pageDescription}
      actions={
        onSchedule && (
          <Button
            onClick={onSchedule}
            icon={
              <svg className="size-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
            }
          >
            {t.interviews.scheduleNew}
          </Button>
        )
      }
    />
  );
}
