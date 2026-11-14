'use client';

import { useI18n } from '../../../../../lib/i18n';
import { formatMessage } from '../../../../../lib/i18n/format';
import { formatDate } from '../../../../../lib/format-utils';
import { CandidateAvatar, StatusBadge, TEXT_LINK_CLASSES } from '../../../../../components';
import type { CandidateDetail } from '../../../../../lib/trpc-types';
import { candidateSourceLabel } from '../../../../../lib/candidate-labels';
import { FIT_BANDS, fitBand, type FitBand } from '../../../../../lib/pipeline-fit';
import { isReviewPending } from '../../../../../lib/platform-api/fit-engine';
import { FitReviewPendingBadge } from '../../fit-review-pending-badge';
import { CARD } from './card-styles';

// The same FIT scale as the pipeline card, list, table and filter (A-23). The ring keeps the band colour; the
// band is also written in words, in status tokens that pass 4.5:1 (accessibility.md › Vision).
const FIT_BORDER: Record<FitBand, string> = {
  high: 'border-success',
  medium: 'border-warning',
  low: 'border-danger',
};
const FIT_TEXT: Record<FitBand, string> = { high: 'text-success', medium: 'text-warning', low: 'text-danger' };

const ICON = 'size-3.5 shrink-0';

/**
 * The candidate's summary card under the page header: contact details, source, the vacancy they applied to and
 * the FIT score. The name, stage and actions live in the page header (one h1, one action group).
 */
export function CandidateHeader({ candidate: c }: { candidate: CandidateDetail }) {
  const { t } = useI18n();
  const fitScore = c.fitScores?.[0]?.overallScore;
  // FIT v2: the score is provisional while a result it counts on awaits review (breakdown.reviewPending).
  const fitPending = isReviewPending(c.fitScores?.[0]?.breakdown);
  const activeApp = c.applications.find((application) => application.status === 'active');
  const band = fitScore != null ? fitBand(fitScore) : null;
  const bandLabel =
    band === 'high' ? t.candidates.highFit : band === 'medium' ? t.candidates.mediumFit : t.candidates.lowFit;

  return (
    <section className={`${CARD} mb-6`} aria-label={t.candidates.profileHeader}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
        <div className="flex items-center gap-4 sm:contents">
          <CandidateAvatar firstName={c.firstName} lastName={c.lastName} avatar={c.avatar} size="lg" decorative />
          {fitScore != null && band && (
            <div className="flex flex-col items-center gap-1 sm:order-last sm:ml-auto">
              <div
                role="img"
                aria-label={formatMessage(t.candidates.fitCircleLabel, { score: fitScore, band: bandLabel })}
                className="flex flex-col items-center"
              >
                <div
                  className={`flex size-16 items-center justify-center rounded-full border-4 sm:size-20 ${FIT_BORDER[band]}`}
                  aria-hidden="true"
                >
                  <div className="text-center">
                    <span className="text-xl font-bold tabular-nums text-brand sm:text-2xl">{fitScore}</span>
                    <p className="-mt-0.5 text-caption text-muted">{t.candidates.fitCircleCaption}</p>
                  </div>
                </div>
                <span className={`mt-1 text-caption font-semibold ${FIT_TEXT[band]}`} aria-hidden="true">
                  {bandLabel}
                </span>
              </div>
              {fitPending && <FitReviewPendingBadge compact />}
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          {activeApp && (
            <p className="mb-2 text-body text-secondary">
              {t.candidates.applyingTo} <span className="font-medium text-brand">{activeApp.vacancy.title}</span>
            </p>
          )}

          <ul className="flex flex-wrap items-center gap-x-4 gap-y-2 text-callout text-secondary">
            <li className="flex min-w-0 items-center gap-1">
              <svg
                className={ICON}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
              </svg>
              <span className="break-all">{c.email}</span>
            </li>
            {c.phone && (
              <li className="flex items-center gap-1">
                <svg
                  className={ICON}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
                </svg>
                {c.phone}
              </li>
            )}
            {c.location && (
              <li className="flex items-center gap-1">
                <svg
                  className={ICON}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                </svg>
                {c.location}
              </li>
            )}
            {c.linkedinUrl && (
              <li>
                <a href={c.linkedinUrl} target="_blank" rel="noopener noreferrer" className={TEXT_LINK_CLASSES}>
                  <svg
                    className={ICON}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-1.06l4.5-4.5a4.5 4.5 0 00-6.364-6.364l-1.757 1.757" />
                  </svg>
                  LinkedIn
                </a>
              </li>
            )}
            <li>
              <StatusBadge tone="neutral" icon="none">
                {t.candidates.sourceLabel} {candidateSourceLabel(c.source, t.candidates)}
              </StatusBadge>
            </li>
            {activeApp && (
              <li className="text-caption text-muted">
                {t.candidates.applied} {formatDate(activeApp.appliedAt)}
              </li>
            )}
          </ul>
        </div>
      </div>

      {/* AI recommendation: marked as AI and stated as a suggestion (generative-ai.md › Transparency). */}
      {fitScore != null && fitScore >= FIT_BANDS.high && (
        <div className="mt-4 flex items-start gap-2 rounded-lg bg-brand-tint p-3">
          <svg
            className="mt-0.5 size-4 shrink-0 text-brand"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
          </svg>
          <div className="text-callout text-brand">
            <span className="font-semibold">{t.candidates.aiRecommendation}</span> {t.candidates.highFit} (FIT{' '}
            {fitScore})
            {fitPending && (
              <div className="mt-1">
                <FitReviewPendingBadge />
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
