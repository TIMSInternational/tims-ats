'use client';

import Link from 'next/link';
import { useI18n } from '../../../../lib/i18n';
import { formatDate } from '../../../../lib/format-utils';
import { DataTable, EmptyState, ErrorState, CandidateAvatar, FitScoreBadge, StatusBadge } from '../../../../components';
import type { CandidateListItem } from '../../../../lib/trpc-types';
import { candidatePoolLabel, candidateSourceLabel } from '../../../../lib/candidate-labels';
import { useReviewPendingFitScores } from '../../../../lib/platform-api/fit-engine';
import { FitReviewPendingBadge } from '../fit-review-pending-badge';

interface CandidateTableProps {
  candidates: CandidateListItem[];
  isLoading: boolean;
  isError?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** A search or filter is active, so an empty list means "no match", not "no candidates". */
  hasFilters?: boolean;
  onClearFilters?: () => void;
  onCreate?: () => void;
}

const MAX_TAGS = 2;

export function CandidateTable({
  candidates,
  isLoading,
  isError,
  error,
  onRetry,
  hasFilters,
  onClearFilters,
  onCreate,
}: CandidateTableProps) {
  const { t } = useI18n();
  // FIT v2: which shown scores are provisional (from C#; candidate.list carries the id, not the breakdown).
  // A failed read is shown as "unknown", never as final.
  const reviewState = useReviewPendingFitScores(
    candidates.flatMap((c) => (c.fitScores?.[0]?.id ? [c.fitScores[0].id] : [])),
  );
  const pendingFit = reviewState.data;

  if (isError) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-white shadow-card">
        <ErrorState message={t.candidates.listLoadError} onRetry={onRetry} error={error} />
      </div>
    );
  }

  const columns = [
    { key: 'name', label: t.candidates.colName },
    { key: 'pool', label: t.candidates.colPool },
    { key: 'source', label: t.candidates.colSource },
    { key: 'fit', label: t.candidates.colFitScore, align: 'center' as const },
    { key: 'apps', label: t.candidates.applications, align: 'right' as const },
    { key: 'tags', label: t.candidates.colTags },
    { key: 'created', label: t.candidates.colCreated },
  ];

  const fitCell = (c: CandidateListItem) => {
    const fitScore = c.fitScores?.[0]?.overallScore;
    if (fitScore == null) {
      return (
        <span className="text-muted">
          <span aria-hidden="true">—</span>
          <span className="sr-only">{t.candidates.noFitScore}</span>
        </span>
      );
    }
    return (
      <div className="flex flex-col items-center gap-1">
        <FitScoreBadge score={fitScore} size="md" />
        {reviewState.isError ? (
          <FitReviewPendingBadge compact unknown />
        ) : (
          pendingFit?.has(c.fitScores[0].id) && <FitReviewPendingBadge compact />
        )}
      </div>
    );
  };

  const empty = hasFilters ? (
    <EmptyState
      icon={
        <svg
          className="size-8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" strokeLinecap="round" />
        </svg>
      }
      title={t.candidates.noMatches}
      description={t.candidates.noMatchesDesc}
      action={
        onClearFilters ? { label: t.common.clearFilters, onClick: onClearFilters, variant: 'secondary' } : undefined
      }
    />
  ) : (
    <EmptyState
      title={t.candidates.noCandidates}
      description={t.candidates.noCandidatesDesc}
      action={onCreate ? { label: t.candidates.newCandidate, onClick: onCreate, variant: 'secondary' } : undefined}
    />
  );

  const mobileList = candidates.map((c) => (
    <Link
      key={c.id}
      href={`/recruitment/candidates/${c.id}`}
      className="flex min-h-12 items-center gap-3 px-4 py-3 hover:bg-surface-hover"
    >
      <CandidateAvatar firstName={c.firstName} lastName={c.lastName} avatar={c.avatar} size="sm" decorative />
      <div className="min-w-0 flex-1">
        <p className="truncate text-body font-medium text-primary">
          {c.firstName} {c.lastName}
        </p>
        <p className="truncate text-callout text-secondary">{c.email}</p>
        <StatusBadge tone="neutral" icon="none" className="mt-1">
          {candidatePoolLabel(c.poolType, t.candidates)}
        </StatusBadge>
      </div>
      {c.fitScores?.[0]?.overallScore != null && <FitScoreBadge score={c.fitScores[0].overallScore} size="md" />}
      <svg
        className="size-4 shrink-0 text-muted"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  ));

  return (
    <DataTable
      columns={columns}
      loading={isLoading}
      skeletonRows={8}
      label={t.candidates.title}
      mobileList={mobileList}
      empty={empty}
    >
      {candidates.map((c) => (
        <tr key={c.id} className="border-b border-border hover:bg-surface-hover">
          <td className="px-4 py-3">
            <Link href={`/recruitment/candidates/${c.id}`} className="group flex items-center gap-3 rounded-lg">
              <CandidateAvatar firstName={c.firstName} lastName={c.lastName} avatar={c.avatar} size="sm" decorative />
              <div className="min-w-0">
                <p className="text-body font-medium text-primary group-hover:underline">
                  {c.firstName} {c.lastName}
                </p>
                <p className="text-callout text-secondary">{c.email}</p>
              </div>
            </Link>
          </td>
          <td className="px-4 py-3">
            <StatusBadge tone="neutral" icon="none">
              {candidatePoolLabel(c.poolType, t.candidates)}
            </StatusBadge>
          </td>
          <td className="px-4 py-3 text-body text-secondary">{candidateSourceLabel(c.source, t.candidates)}</td>
          <td className="px-4 py-3 text-center">{fitCell(c)}</td>
          <td className="px-4 py-3 text-right text-body tabular-nums text-primary">{c._count.applications}</td>
          <td className="px-4 py-3">
            <div className="flex max-w-40 flex-wrap gap-1">
              {c.tags.slice(0, MAX_TAGS).map((tag) => (
                <StatusBadge key={tag.id} tone="neutral" icon="none">
                  {tag.tag}
                </StatusBadge>
              ))}
              {c.tags.length > MAX_TAGS && <span className="text-caption text-muted">+{c.tags.length - MAX_TAGS}</span>}
            </div>
          </td>
          <td className="px-4 py-3 text-body tabular-nums text-secondary">{formatDate(c.createdAt)}</td>
        </tr>
      ))}
    </DataTable>
  );
}
