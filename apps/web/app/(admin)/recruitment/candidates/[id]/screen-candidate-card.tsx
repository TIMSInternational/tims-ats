'use client';

import { useState } from 'react';
import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import { toast } from '../../../../../lib/toast';
import { Button, Select, StatusBadge, type StatusTone } from '../../../../../components';
import { AiSuggestionNotice } from '../../../../../components/ai-suggestion-notice';
import { CARD, CARD_TITLE } from './card-styles';

interface Vacancy {
  id: string;
  title: string;
}

const REC_META: Record<string, { key: 'recAdvance' | 'recReview' | 'recReject'; tone: StatusTone }> = {
  advance: { key: 'recAdvance', tone: 'success' },
  review: { key: 'recReview', tone: 'warning' },
  reject: { key: 'recReject', tone: 'danger' },
};

const META_LABEL = 'mb-1 text-callout text-secondary';

/**
 * Compares the candidate with one of their vacancies and SAVES the result as a suggested FIT score. The card
 * says so before the run, and marks the output as an AI suggestion (generative-ai.md › Transparency).
 */
export function ScreenCandidateCard({ candidateId, vacancies }: { candidateId: string; vacancies: Vacancy[] }) {
  const { t } = useI18n();
  const ai = t.candidateAi;
  const utils = trpc.useUtils();
  const [vacancyId, setVacancyId] = useState(vacancies[0]?.id ?? '');

  const screen = trpc.candidate.screen.useMutation({
    onSuccess: () => {
      toast(ai.screenSaved, { type: 'success' });
      // Refresh the candidate so the new FitScore shows in FitBreakdown.
      void utils.candidate.getById.invalidate({ id: candidateId });
    },
    onError: () => toast(ai.screenError, { type: 'error' }),
  });
  const r = screen.data;

  return (
    <section className={CARD}>
      <h2 className={`${CARD_TITLE} mb-1`}>{ai.screenTitle}</h2>
      <p className="mb-3 text-callout text-secondary">{ai.screenDescription}</p>

      {vacancies.length === 0 ? (
        <p className="text-body text-secondary">{ai.screenNoVacancies}</p>
      ) : (
        <>
          <AiSuggestionNotice className="mb-3" />
          {/* Stacked: in the narrow record column a side-by-side row squeezes the vacancy name. */}
          <div className="flex flex-col items-stretch gap-2 sm:items-start">
            <label htmlFor={`screen-vacancy-${candidateId}`} className="sr-only">
              {ai.screenVacancyLabel}
            </label>
            <Select
              id={`screen-vacancy-${candidateId}`}
              value={vacancyId}
              onChange={(e) => setVacancyId(e.target.value)}
              className="w-full min-w-0"
            >
              {vacancies.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.title}
                </option>
              ))}
            </Select>
            <Button
              variant="secondary"
              onClick={() => screen.mutate({ candidateId, vacancyId })}
              disabled={!vacancyId}
              loading={screen.isPending}
              loadingLabel={ai.screening}
              className="w-full sm:w-auto"
            >
              {ai.screenButton}
            </Button>
          </div>

          {r && (
            <div className="mt-3 space-y-3 border-t border-border pt-3 text-body">
              <div className="flex items-center justify-between gap-3">
                <span className="text-secondary">{ai.score}</span>
                {r.score === null ? (
                  <span className="text-secondary">{ai.scoreUnavailable}</span>
                ) : (
                  <span className="text-xl font-bold tabular-nums text-brand">
                    {r.score}
                    <span className="text-callout font-normal text-secondary">/100</span>
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-secondary">{ai.recommendation}</span>
                <StatusBadge tone={REC_META[r.recommendation]?.tone ?? 'warning'}>
                  {ai[REC_META[r.recommendation]?.key ?? 'recReview']}
                </StatusBadge>
              </div>
              {r.matchedSkills.length > 0 && (
                <div>
                  <h3 className={META_LABEL}>{ai.matchedSkills}</h3>
                  <div className="flex flex-wrap gap-1">
                    {r.matchedSkills.map((s) => (
                      <StatusBadge key={s} tone="success">
                        {s}
                      </StatusBadge>
                    ))}
                  </div>
                </div>
              )}
              {r.missingSkills.length > 0 && (
                <div>
                  <h3 className={META_LABEL}>{ai.missingSkills}</h3>
                  <div className="flex flex-wrap gap-1">
                    {r.missingSkills.map((s) => (
                      <StatusBadge key={s} tone="neutral" icon="none">
                        {s}
                      </StatusBadge>
                    ))}
                  </div>
                </div>
              )}
              {r.reasoning && (
                <div>
                  <h3 className={META_LABEL}>{ai.reasoning}</h3>
                  <p className="text-body text-primary">{r.reasoning}</p>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
