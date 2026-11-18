'use client';

import { EmptyState, ErrorState } from '../../../../components';
import { useI18n } from '../../../../lib/i18n';
import type { BoardStatus } from '../../../../lib/pipeline-url-state';

export type BoardPlaceholderKind = 'vacanciesError' | 'noVacancies' | 'noVacancySelected' | 'boardError' | 'empty';

/** Which placeholder the board area shows, in priority order; null while loading or when the board renders. */
export function boardPlaceholderKind(state: {
  vacanciesError: boolean;
  loading: boolean;
  vacancyCount: number;
  hasSelection: boolean;
  boardError: boolean;
  empty: boolean;
}): BoardPlaceholderKind | null {
  if (state.vacanciesError) return 'vacanciesError';
  if (state.loading) return null;
  if (state.vacancyCount === 0) return 'noVacancies';
  if (!state.hasSelection) return 'noVacancySelected';
  if (state.boardError) return 'boardError';
  return state.empty ? 'empty' : null;
}

interface PipelineBoardPlaceholderProps {
  kind: BoardPlaceholderKind;
  onRetry?: () => void;
  error?: unknown;
  boardStatus: BoardStatus;
  /** Candidates exist, but the active filters hide all of them. */
  hiddenByFilters: boolean;
  onClearFilters: () => void;
  /** Omitted when the user cannot add candidates. */
  onAddCandidate?: () => void;
}

/**
 * What the board area shows instead of the board: a load error that names what failed, or an empty state
 * that says why it is empty and offers the next step (writing.md: "Provide clear next steps").
 */
export function PipelineBoardPlaceholder({
  kind,
  onRetry,
  error,
  boardStatus,
  hiddenByFilters,
  onClearFilters,
  onAddCandidate,
}: PipelineBoardPlaceholderProps) {
  const { t } = useI18n();
  const p = t.pipeline;
  const rejected = boardStatus === 'rejected';

  const content = (() => {
    switch (kind) {
      case 'vacanciesError':
        return <ErrorState title={p.vacanciesLoadError} onRetry={onRetry} />;
      case 'boardError':
        return <ErrorState title={p.boardLoadError} onRetry={onRetry} error={error} />;
      case 'noVacancies':
        return (
          <EmptyState
            title={p.noPublishedVacancies}
            description={p.noPublishedVacanciesHint}
            action={{ label: p.goToVacancies, href: '/recruitment/vacancies', variant: 'secondary' }}
          />
        );
      case 'noVacancySelected':
        return <EmptyState title={p.noVacancySelected} />;
      case 'empty':
        return hiddenByFilters ? (
          <EmptyState
            title={p.noFilterMatches}
            description={p.noFilterMatchesHint}
            action={{ label: t.common.clearFilters, onClick: onClearFilters, variant: 'secondary' }}
          />
        ) : (
          <EmptyState
            title={rejected ? p.noRejectedCandidates : p.noCandidatesInPipeline}
            description={rejected ? undefined : p.noCandidatesHint}
            action={
              !rejected && onAddCandidate
                ? { label: p.addCandidate, onClick: onAddCandidate, variant: 'secondary' }
                : undefined
            }
          />
        );
    }
  })();

  return <div className="h-full flex items-center justify-center">{content}</div>;
}
