'use client';

import { useState } from 'react';
import Link from 'next/link';
import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { useCan } from '../../../lib/permissions';
import { toast } from '../../../lib/toast';
import { ErrorState } from '../../../components';
import { deriveSetupChecklistRows } from './setup-checklist-rows';

function CheckIcon({ done }: { done: boolean }) {
  return (
    <span
      className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
        done ? 'bg-green-50 text-green-500' : 'bg-[#F6F6F6] text-[#B8B8B8]'
      }`}
    >
      <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
        <path d="m4.5 12.75 6 6 9-13.5" />
      </svg>
    </span>
  );
}

export function SetupChecklist() {
  const { t } = useI18n();
  const sc = t.setupChecklist;
  const utils = trpc.useUtils();
  const can = useCan();
  const canManageBranding = can('organization', 'update');

  // Optimistic client-side hide the instant "hide for now" is clicked, backed
  // by the real dismissSetupChecklist mutation (per Task 4 brief). Reverted on
  // mutation failure so the widget doesn't vanish for a dismissal that never
  // actually persisted.
  const [hiddenOptimistic, setHiddenOptimistic] = useState(false);

  const statusQuery = trpc.organization.getSetupStatus.useQuery();
  const dismiss = trpc.organization.dismissSetupChecklist.useMutation({
    onSuccess: () => {
      utils.organization.getSetupStatus.invalidate();
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
      setHiddenOptimistic(false);
    },
  });

  if (hiddenOptimistic) return null;

  const data = statusQuery.data;
  // Auto-hides entirely (not just visually collapsed) once everything is
  // done, or once the server confirms a still-fresh dismissal.
  if (data && (data.allComplete || data.dismissedAt !== null)) return null;

  const rows = data
    ? deriveSetupChecklistRows(
        data.items,
        {
          companyStructureReady: sc.companyStructureReady,
          teamInvited: sc.teamInvited,
          brandingSet: sc.brandingSet,
          firstVacancyPosted: sc.firstVacancyPosted,
          firstVacancyPublished: sc.firstVacancyPublished,
        },
        canManageBranding,
      )
    : [];

  const onDismiss = () => {
    setHiddenOptimistic(true);
    dismiss.mutate();
  };

  return (
    <div className="mx-6 mt-6 bg-white rounded-xl p-4 shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
      <div className="flex justify-between items-center mb-4">
        <span className="text-sm font-semibold text-[#1F114C]">{sc.title}</span>
        {data && !statusQuery.isError && (
          <button
            type="button"
            onClick={onDismiss}
            disabled={dismiss.isPending}
            className="text-[12px] text-[#8B8B8B] hover:text-[#1F114C] transition disabled:opacity-50"
          >
            {sc.hideForNow}
          </button>
        )}
      </div>

      {statusQuery.isLoading ? (
        <div className="space-y-2 animate-pulse">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-8 bg-gray-100 rounded" />
          ))}
        </div>
      ) : statusQuery.isError || !data ? (
        <ErrorState onRetry={() => statusQuery.refetch()} />
      ) : (
        <div className="space-y-1">
          {rows.map((row) => (
            <div key={row.key} className="flex items-center justify-between rounded-lg px-3 py-2 -mx-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <CheckIcon done={row.done} />
                <span className={`text-[13px] truncate ${row.done ? 'text-[#8B8B8B] line-through' : 'text-[#333]'}`}>
                  {row.label}
                </span>
              </div>
              {!row.done && row.href && (
                <Link
                  href={row.href}
                  className="text-[12px] font-medium text-[#DD0C15] hover:underline shrink-0 ml-3"
                >
                  {sc.goTo}
                </Link>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
