'use client';

import Link from 'next/link';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@tims/api';
import { useI18n } from '../../../lib/i18n';
import { EmptyState, Skeleton } from '../../../components';
import { LoadError } from './load-error';

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
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex-1 bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
      <h2 className="text-sm font-semibold text-[#1F114C] mb-4">{title}</h2>
      {children}
    </div>
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
  const className = 'flex items-center justify-between rounded-lg px-3 py-2.5 -mx-3 hover:bg-[#F6F6F6] transition';
  const content = (
    <>
      <span className="text-sm text-[#333] font-medium truncate">{primary}</span>
      <span className="text-[13px] text-[#8B8B8B] truncate ml-3">{secondary}</span>
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

const EMPTY_ICON = (
  <span className="w-8 h-8 rounded-full bg-[#F0F0F0] inline-block" aria-hidden />
);

export function ScorecardsToSubmitPanel({
  data,
  isLoading,
  isError,
}: {
  data: PendingScorecards | undefined;
  isLoading: boolean;
  isError: boolean;
}) {
  const { t } = useI18n();
  const md = t.managerDashboard;

  return (
    <PanelShell title={md.scorecardsTitle}>
      {isError ? (
        <LoadError message={md.loadError} />
      ) : isLoading ? (
        <SkeletonRows />
      ) : !data || data.length === 0 ? (
        <EmptyState icon={EMPTY_ICON} message={md.noScorecards} />
      ) : (
        <div className="space-y-1">
          {data.map((row) => (
            <TodoRow
              key={row.id}
              href={interviewRoomHref(row.interviewId)}
              documentLoad
              primary={fullName(row.interview.candidate)}
              secondary={row.interview.vacancy.title}
            />
          ))}
        </div>
      )}
    </PanelShell>
  );
}
