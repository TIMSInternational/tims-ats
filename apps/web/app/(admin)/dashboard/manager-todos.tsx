'use client';

import { useId } from 'react';
import Link from 'next/link';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@tims/api';
import { useI18n } from '../../../lib/i18n';
import { formatInterviewWhen } from '../recruitment/interviews/interview-status';
import { EmptyState, Skeleton } from '../../../components';
import { LoadError } from './load-error';
import { CountBadge } from '../../../components/count-badge';

type RouterOutputs = inferRouterOutputs<AppRouter>;
type PendingScorecards = RouterOutputs['interview']['getPendingScorecards'];

function fullName(p: { firstName: string; lastName: string }): string {
  return `${p.firstName} ${p.lastName}`.trim();
}

/** B-27: a pending-scorecard to-do opens that interview's room (scoring stage), not the interviews list. */
export function interviewRoomHref(interviewId: string): string {
  return `/recruitment/interviews/${encodeURIComponent(interviewId)}/room`;
}

function PanelShell({
  title,
  count,
  children,
}: {
  title: string;
  /** Items waiting; shown beside the title (and read as part of it) only when there are any. */
  count?: number;
  children: React.ReactNode;
}) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex-1 rounded-xl bg-white p-5 shadow-card">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 id={titleId} className="text-subheading font-semibold text-brand">
          {title}
          {count ? <span className="sr-only"> ({count})</span> : null}
        </h3>
        <CountBadge count={count ?? 0} />
      </div>
      {children}
    </section>
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex items-center justify-between">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
    </div>
  );
}

function TodoRow({
  href,
  primary,
  secondary,
  documentLoad = false,
}: {
  href: string;
  primary: string;
  secondary: string;
  /** Full document load (plain <a>): the interview room needs its own route's CSP, see interview-table. */
  documentLoad?: boolean;
}) {
  const className =
    '-mx-3 flex flex-wrap items-center justify-between gap-x-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-surface';
  const content = (
    <>
      <span className="min-w-0 truncate text-body font-medium text-primary">{primary}</span>
      <span className="min-w-0 truncate text-callout text-muted">{secondary}</span>
    </>
  );
  return documentLoad ? (
    <a href={href} className={className}>
      {content}
    </a>
  ) : (
    <Link href={href} className={className}>
      {content}
    </Link>
  );
}

export function ScorecardsToSubmitPanel({
  data,
  isLoading,
  isError,
  onRetry,
}: {
  data: PendingScorecards | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry?: () => void;
}) {
  const { t, locale } = useI18n();
  const md = t.managerDashboard;

  return (
    <PanelShell title={md.scorecardsTitle} count={isError || isLoading ? 0 : (data?.length ?? 0)}>
      {isError ? (
        <LoadError message={md.loadError} onRetry={onRetry} />
      ) : isLoading ? (
        <SkeletonRows />
      ) : !data || data.length === 0 ? (
        <EmptyState size="compact" message={md.noScorecards} />
      ) : (
        <ul className="space-y-1">
          {data.map((row) => (
            <li key={row.id}>
              <TodoRow
                href={interviewRoomHref(row.interviewId)}
                documentLoad
                primary={fullName(row.interview.candidate)}
                secondary={[row.interview.vacancy.title, formatInterviewWhen(row.interview.scheduledAt, locale)]
                  .filter(Boolean)
                  .join(' · ')}
              />
            </li>
          ))}
        </ul>
      )}
    </PanelShell>
  );
}
