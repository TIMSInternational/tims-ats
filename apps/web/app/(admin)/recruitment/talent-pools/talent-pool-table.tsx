'use client';

import Link from 'next/link';
import { useI18n } from '../../../../lib/i18n';
import { formatMessage } from '../../../../lib/i18n/format';
import { formatRelativeTimeLocale } from '../../../../lib/format-utils';
import {
  CandidateAvatar,
  DataTable,
  EmptyState,
  ErrorState,
  FitScoreBadge,
  IconButton,
  StatusBadge,
} from '../../../../components';
import { useReviewPendingFitScores } from '../../../../lib/platform-api/fit-engine';
import { FitReviewPendingBadge } from '../fit-review-pending-badge';
import { talentPoolTypeLabel } from './talent-pool-filters';

interface CandidateItem {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  source: string;
  poolType: string;
  avatar: string | null;
  location: string | null;
  currentTitle: string | null;
  currentCompany: string | null;
  skills: unknown;
  yearsExperience: number | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  tags: { id: string; tag: string; source: string }[];
  fitScores: { id: string; overallScore: number; calculatedAt: Date }[];
  _count: { applications: number };
}

interface TalentPoolTableProps {
  candidates: CandidateItem[];
  isLoading: boolean;
  isError?: boolean;
  error?: unknown;
  onRetry?: () => void;
  hasFilters?: boolean;
  onClearFilters?: () => void;
  nextCursor?: string;
  currentCursor?: string;
  onNextPage: () => void;
  onPrevPage: () => void;
}

const MAX_SKILLS = 2;

function skillsOf(c: CandidateItem): string[] {
  return Array.isArray(c.skills) ? c.skills.filter((s): s is string => typeof s === 'string') : [];
}

/** Talent-pool results on the shared DataTable (lists-and-tables.md): real headers, one link per row. */
export function TalentPoolTable({
  candidates,
  isLoading,
  isError,
  error,
  onRetry,
  hasFilters,
  onClearFilters,
  nextCursor,
  currentCursor,
  onNextPage,
  onPrevPage,
}: TalentPoolTableProps) {
  const { t, locale } = useI18n();
  const tp = t.talentPool;
  // FIT v2: which shown scores are provisional (from C#; candidate.list carries the id, not the breakdown).
  // A failed read is shown as "unknown", never as final.
  const reviewState = useReviewPendingFitScores(
    candidates.flatMap((c) => (c.fitScores[0]?.id ? [c.fitScores[0].id] : [])),
  );
  const pendingFit = reviewState.data;

  if (isError) {
    return (
      <div className="overflow-hidden rounded-xl border border-border bg-white shadow-card">
        <ErrorState message={t.candidates.listLoadError} onRetry={onRetry} error={error} />
      </div>
    );
  }

  const meta = (c: CandidateItem) =>
    [
      [c.currentTitle, c.currentCompany].filter(Boolean).join(' — '),
      c.location,
      c.yearsExperience != null ? formatMessage(tp.yearsExpShort, { n: c.yearsExperience }) : null,
    ]
      .filter(Boolean)
      .join(' · ');

  const fitCell = (c: CandidateItem) => {
    const score = c.fitScores[0]?.overallScore;
    if (score == null) {
      return (
        <span className="text-muted">
          <span aria-hidden="true">—</span>
          <span className="sr-only">{t.candidates.noFitScore}</span>
        </span>
      );
    }
    return (
      <span className="inline-flex flex-col items-center gap-1">
        <FitScoreBadge score={Math.round(score)} size="md" />
        {reviewState.isError ? (
          <FitReviewPendingBadge compact unknown />
        ) : (
          pendingFit?.has(c.fitScores[0].id) && <FitReviewPendingBadge compact />
        )}
      </span>
    );
  };

  const columns = [
    { key: 'name', label: tp.candidate },
    { key: 'fit', label: tp.fitScore, align: 'center' as const },
    { key: 'type', label: tp.type },
    { key: 'activity', label: tp.lastActivity },
    { key: 'skills', label: tp.skills },
  ];

  const empty = (
    <EmptyState
      title={tp.noCandidatesFound}
      description={hasFilters ? tp.noCandidatesFilteredDesc : tp.noCandidatesEmptyDesc}
      action={
        hasFilters && onClearFilters
          ? { label: t.common.clearFilters, onClick: onClearFilters, variant: 'secondary' }
          : undefined
      }
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
        {meta(c) && <p className="truncate text-callout text-secondary">{meta(c)}</p>}
        <StatusBadge tone="neutral" icon="none" className="mt-1">
          {talentPoolTypeLabel(c.poolType, t.candidates, tp)}
        </StatusBadge>
      </div>
      {c.fitScores[0]?.overallScore != null && (
        <FitScoreBadge score={Math.round(c.fitScores[0].overallScore)} size="md" />
      )}
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
    <>
      <DataTable
        columns={columns}
        loading={isLoading}
        skeletonRows={6}
        label={tp.title}
        mobileList={mobileList}
        empty={empty}
      >
        {candidates.map((c) => (
          <tr key={c.id} className="border-b border-border hover:bg-surface-hover">
            <td className="px-4 py-3">
              <Link href={`/recruitment/candidates/${c.id}`} className="group flex items-center gap-3 rounded-lg">
                <CandidateAvatar firstName={c.firstName} lastName={c.lastName} avatar={c.avatar} size="md" decorative />
                <div className="min-w-0">
                  <p className="text-body font-medium text-primary group-hover:underline">
                    {c.firstName} {c.lastName}
                  </p>
                  {meta(c) && <p className="text-callout text-secondary">{meta(c)}</p>}
                </div>
              </Link>
            </td>
            <td className="px-4 py-3 text-center">{fitCell(c)}</td>
            <td className="px-4 py-3">
              <StatusBadge tone="neutral" icon="none">
                {talentPoolTypeLabel(c.poolType, t.candidates, tp)}
              </StatusBadge>
            </td>
            <td className="px-4 py-3 text-body text-secondary">
              {formatRelativeTimeLocale(c.updatedAt || c.createdAt, locale)}
            </td>
            <td className="px-4 py-3">
              <div className="flex max-w-48 flex-wrap gap-1">
                {skillsOf(c)
                  .slice(0, MAX_SKILLS)
                  .map((skill) => (
                    <StatusBadge key={skill} tone="neutral" icon="none">
                      {skill}
                    </StatusBadge>
                  ))}
                {c.tags.slice(0, 1).map((tag) => (
                  <StatusBadge key={tag.id} tone="brand" icon="none">
                    {tag.tag}
                  </StatusBadge>
                ))}
              </div>
            </td>
          </tr>
        ))}
      </DataTable>

      {!isLoading && (currentCursor || nextCursor) && (
        <nav className="mt-3 flex items-center justify-end gap-1" aria-label={t.common.pagination}>
          <IconButton label={t.common.prevPage} variant="secondary" onClick={onPrevPage} disabled={!currentCursor}>
            <svg
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M15 19l-7-7 7-7" />
            </svg>
          </IconButton>
          <IconButton label={t.common.nextPage} variant="secondary" onClick={onNextPage} disabled={!nextCursor}>
            <svg
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M9 5l7 7-7 7" />
            </svg>
          </IconButton>
        </nav>
      )}
    </>
  );
}
