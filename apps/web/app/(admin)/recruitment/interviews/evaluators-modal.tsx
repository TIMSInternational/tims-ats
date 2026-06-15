'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { Modal, UserPicker, CandidateAvatar, Skeleton } from '../../../../components';

interface EvaluatorsModalProps {
  interviewId: string;
  onClose: () => void;
}

export function EvaluatorsModal({ interviewId, onClose }: EvaluatorsModalProps) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const [adding, setAdding] = useState(false);

  const interview = trpc.interview.getById.useQuery({ id: interviewId });

  const invalidate = () => {
    utils.interview.getById.invalidate({ id: interviewId });
    utils.interview.list.invalidate();
  };

  const add = trpc.interview.addEvaluator.useMutation({
    onSuccess: () => {
      toast(t.committee.added, { type: 'success' });
      setAdding(false);
      invalidate();
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
    },
  });

  const remove = trpc.interview.removeEvaluator.useMutation({
    onSuccess: () => {
      toast(t.committee.removed, { type: 'success' });
      invalidate();
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
    },
  });

  const evaluators = interview.data?.evaluators ?? [];
  const assignedIds = evaluators.map((e) => e.user.id);

  const onRemove = (userId: string) => {
    if (window.confirm(t.committee.removeConfirm)) {
      remove.mutate({ interviewId, userId });
    }
  };

  return (
    <Modal title={t.committee.evaluators} onClose={onClose}>
      {interview.isLoading ? (
        <Skeleton className="h-24 w-full rounded-lg" />
      ) : interview.isError ? (
        <p className="text-[12px] text-[#DD0C15]">{interview.error.message}</p>
      ) : (
        <>
          {evaluators.length === 0 ? (
            <p className="text-[12px] text-[#8B8B8B] py-4 text-center">{t.committee.noEvaluators}</p>
          ) : (
            <ul className="space-y-1.5 mb-3">
              {evaluators.map((ev) => (
                <li key={ev.id} className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-[#EDEDED]">
                  <CandidateAvatar firstName={ev.user.firstName} lastName={ev.user.lastName} avatar={ev.user.avatar} size="sm" />
                  <span className="text-[12px] text-[#333] font-medium flex-1">
                    {ev.user.firstName} {ev.user.lastName}
                  </span>
                  <button
                    onClick={() => onRemove(ev.user.id)}
                    disabled={remove.isPending}
                    className="h-7 px-2.5 rounded-md text-[11px] text-[#DD0C15] border border-red-200 hover:bg-red-50 transition disabled:opacity-50"
                  >
                    {t.committee.remove}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {adding ? (
            <UserPicker
              excludeIds={assignedIds}
              disabled={add.isPending}
              onSelect={(userId) => add.mutate({ interviewId, userId })}
              searchPlaceholder={t.committee.searchUser}
              loadingLabel={t.committee.loadingUsers}
              emptyLabel={t.committee.noUsers}
            />
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="flex items-center gap-1.5 bg-[#1F114C] text-white px-4 h-8 rounded-lg text-[12px] font-medium hover:bg-[#2a1863] transition"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 4.5v15m7.5-7.5h-15" /></svg>
              {t.committee.addEvaluator}
            </button>
          )}

          <div className="flex justify-end mt-5">
            <button
              onClick={onClose}
              className="h-9 px-4 rounded-lg text-[12px] text-[#585858] border border-[#EDEDED] hover:bg-[#F6F6F6] transition"
            >
              {t.committee.close}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
