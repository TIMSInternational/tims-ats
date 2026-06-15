'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { UserPicker, CandidateAvatar, Skeleton } from '../../../../components';

interface CommitteeMembersPanelProps {
  sessionId: string;
}

/**
 * Committee-membership manager for a single calibration session.
 * Reads `ninebox.getCalibration().members`; add/remove via
 * addCalibrationMember / removeCalibrationMember, invalidating getCalibration
 * on success. Self-contained — mount it anywhere a sessionId is in scope.
 */
export function CommitteeMembersPanel({ sessionId }: CommitteeMembersPanelProps) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const [adding, setAdding] = useState(false);

  const calibration = trpc.ninebox.getCalibration.useQuery({ id: sessionId });

  const invalidate = () => utils.ninebox.getCalibration.invalidate({ id: sessionId });

  const add = trpc.ninebox.addCalibrationMember.useMutation({
    onSuccess: () => {
      toast(t.committee.added, { type: 'success' });
      setAdding(false);
      invalidate();
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
    },
  });

  const remove = trpc.ninebox.removeCalibrationMember.useMutation({
    onSuccess: () => {
      toast(t.committee.removed, { type: 'success' });
      invalidate();
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
    },
  });

  const memberRows = calibration.data?.members ?? [];
  const assignedIds = memberRows.map((m) => m.user.id);

  const onRemove = (userId: string) => {
    if (window.confirm(t.committee.removeConfirm)) {
      remove.mutate({ sessionId, userId });
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] font-semibold text-[#1F114C]">{t.committee.members}</p>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1 text-[11px] text-[#1F114C] font-medium hover:underline"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 4.5v15m7.5-7.5h-15" /></svg>
            {t.committee.addMember}
          </button>
        )}
      </div>

      {calibration.isLoading ? (
        <Skeleton className="h-20 w-full rounded-lg" />
      ) : calibration.isError ? (
        <p className="text-[12px] text-[#DD0C15]">{calibration.error.message}</p>
      ) : (
        <>
          {memberRows.length === 0 ? (
            <p className="text-[12px] text-[#8B8B8B] py-3 text-center">{t.committee.noMembers}</p>
          ) : (
            <ul className="space-y-1.5 mb-3">
              {memberRows.map((m) => (
                <li key={m.id} className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-[#EDEDED]">
                  <CandidateAvatar firstName={m.user.firstName} lastName={m.user.lastName} avatar={m.user.avatar} size="sm" />
                  <span className="text-[12px] text-[#333] font-medium flex-1">
                    {m.user.firstName} {m.user.lastName}
                  </span>
                  <button
                    onClick={() => onRemove(m.user.id)}
                    disabled={remove.isPending}
                    className="h-7 px-2.5 rounded-md text-[11px] text-[#DD0C15] border border-red-200 hover:bg-red-50 transition disabled:opacity-50"
                  >
                    {t.committee.remove}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {adding && (
            <UserPicker
              excludeIds={assignedIds}
              disabled={add.isPending}
              onSelect={(userId) => add.mutate({ sessionId, userId })}
              searchPlaceholder={t.committee.searchUser}
              loadingLabel={t.committee.loadingUsers}
              emptyLabel={t.committee.noUsers}
            />
          )}
        </>
      )}
    </div>
  );
}
