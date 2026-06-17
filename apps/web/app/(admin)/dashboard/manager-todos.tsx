'use client';

import Link from 'next/link';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@tims/api';
import { useI18n } from '../../../lib/i18n';
import { EmptyState, Skeleton } from '../../../components';
import { LoadError } from './load-error';

type RouterOutputs = inferRouterOutputs<AppRouter>;
type PendingOffers = RouterOutputs['offer']['getPending'];
type PendingScorecards = RouterOutputs['interview']['getPendingScorecards'];

function fullName(p: { firstName: string; lastName: string }): string {
  return `${p.firstName} ${p.lastName}`.trim();
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
}: {
  href: string;
  primary: string;
  secondary: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between rounded-lg px-3 py-2.5 -mx-3 hover:bg-[#F6F6F6] transition"
    >
      <span className="text-sm text-[#333] font-medium truncate">{primary}</span>
      <span className="text-[13px] text-[#8B8B8B] truncate ml-3">{secondary}</span>
    </Link>
  );
}

const EMPTY_ICON = (
  <span className="w-8 h-8 rounded-full bg-[#F0F0F0] inline-block" aria-hidden />
);

export function OffersToApprovePanel({
  data,
  isLoading,
  isError,
}: {
  data: PendingOffers | undefined;
  isLoading: boolean;
  isError: boolean;
}) {
  const { t } = useI18n();
  const md = t.managerDashboard;

  return (
    <PanelShell title={md.approveOffersTitle}>
      {isError ? (
        <LoadError message={md.loadError} />
      ) : isLoading ? (
        <SkeletonRows />
      ) : !data || data.length === 0 ? (
        <EmptyState icon={EMPTY_ICON} message={md.noOffers} />
      ) : (
        <div className="space-y-1">
          {data.map((row) => (
            <TodoRow
              key={row.approvalId}
              href="/recruitment/offers"
              primary={fullName(row.offer.candidate)}
              secondary={row.offer.vacancy.title}
            />
          ))}
        </div>
      )}
    </PanelShell>
  );
}

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
              href="/recruitment/interviews"
              primary={fullName(row.interview.candidate)}
              secondary={row.interview.vacancy.title}
            />
          ))}
        </div>
      )}
    </PanelShell>
  );
}
