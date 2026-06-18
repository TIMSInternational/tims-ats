'use client';

import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { EmptyState, Skeleton } from '../../../components';
import { LoadError } from './load-error';
import { formatDate } from '../../../lib/format-utils';

const EMPTY_ICON = (
  <span className="w-8 h-8 rounded-full bg-[#F0F0F0] inline-block" aria-hidden />
);

const LIST_LIMIT = 50;

function SkeletonRows() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-64" />
        </div>
      ))}
    </div>
  );
}

function senderName(fromUser: { firstName: string | null; lastName: string | null } | null): string {
  if (!fromUser) return '';
  return [fromUser.firstName, fromUser.lastName].filter(Boolean).join(' ').trim();
}

// "Reconocimientos" — OWN-scoped recognition the caller RECEIVED. The endpoint
// (performance.myRecognitions) is hard-pinned to toUserId: ctx.user.id; the row
// carries the sender's display name (Recognition has no anonymity flag). Each row
// shows the category badge, message, sender and date.
export function EmployeeRecognition() {
  const { t } = useI18n();
  const e = t.employeeHome;
  const query = trpc.performance.myRecognitions.useQuery({ limit: LIST_LIMIT });
  const list = query.data?.recognitions ?? [];

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 mb-8">
      <h2 className="text-sm font-semibold text-[#1F114C] mb-4">{e.recognition}</h2>
      {query.isError ? (
        <LoadError message={e.loadError} />
      ) : query.isLoading ? (
        <SkeletonRows />
      ) : list.length === 0 ? (
        <EmptyState icon={EMPTY_ICON} message={e.noRecognitions} />
      ) : (
        <div className="space-y-4">
          {list.map((recognition) => {
            const sender = senderName(recognition.fromUser);
            return (
              <div key={recognition.id} className="rounded-lg px-3 py-2.5 -mx-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="inline-flex items-center rounded-full bg-[#EEEAFB] px-2.5 py-0.5 text-[12px] font-medium text-[#6C4FE0]">
                    {recognition.category}
                  </span>
                  <span className="text-[13px] text-[#8B8B8B] ml-3 shrink-0">
                    {formatDate(recognition.createdAt)}
                  </span>
                </div>
                <p className="text-sm text-[#333]">{recognition.message}</p>
                {sender ? (
                  <p className="text-[13px] text-[#8B8B8B] mt-1">
                    {e.recognitionFrom} {sender}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
