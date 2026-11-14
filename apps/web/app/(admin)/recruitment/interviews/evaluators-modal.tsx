'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { Modal, UserPicker, CandidateAvatar, Skeleton, ErrorState } from '../../../../components';
import { Button } from '../../../../components/button';

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

  // Removing asks inline, inside the row, instead of stacking a browser confirm() over this dialog
  // (alerts.md › Buttons, sheets.md: "Display only one sheet at a time").
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  return (
    <Modal
      title={t.committee.evaluators}
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t.committee.close}
        </Button>
      }
    >
      {interview.isLoading ? (
        <div aria-busy="true">
          <span className="sr-only">{t.common.loadingContent}</span>
          <Skeleton className="h-24 w-full rounded-lg" />
        </div>
      ) : interview.isError ? (
        <ErrorState error={interview.error} onRetry={() => void interview.refetch()} size="compact" />
      ) : (
        <>
          {evaluators.length === 0 ? (
            <p className="py-4 text-center text-callout text-secondary">{t.committee.noEvaluators}</p>
          ) : (
            <ul className="mb-3 space-y-1.5">
              {evaluators.map((ev) => {
                const name = `${ev.user.firstName} ${ev.user.lastName}`;
                const confirming = confirmingId === ev.user.id;
                return (
                  <li key={ev.id} className="flex flex-wrap items-center gap-2.5 rounded-lg border border-border px-3 py-2">
                    <CandidateAvatar
                      firstName={ev.user.firstName}
                      lastName={ev.user.lastName}
                      avatar={ev.user.avatar}
                      size="sm"
                      decorative
                    />
                    {confirming ? (
                      <>
                        <span role="alert" className="min-w-0 flex-1 text-callout font-medium text-primary">
                          {t.interviews.removeEvaluatorConfirm.replace('{name}', name)}
                        </span>
                        <Button size="sm" variant="secondary" onClick={() => setConfirmingId(null)}>
                          {t.common.cancel}
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          loading={remove.isPending}
                          onClick={() => remove.mutate({ interviewId, userId: ev.user.id }, { onSettled: () => setConfirmingId(null) })}
                        >
                          {t.committee.remove}
                        </Button>
                      </>
                    ) : (
                      <>
                        <span className="min-w-0 flex-1 text-callout font-medium text-primary">{name}</span>
                        <Button
                          size="sm"
                          variant="destructive-secondary"
                          disabled={remove.isPending}
                          aria-label={t.interviews.removeEvaluatorLabel.replace('{name}', name)}
                          onClick={() => setConfirmingId(ev.user.id)}
                        >
                          {t.committee.remove}
                        </Button>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {adding ? (
            <UserPicker
              purpose="interview_evaluator"
              excludeIds={assignedIds}
              disabled={add.isPending}
              onSelect={(userId) => add.mutate({ interviewId, userId })}
              searchPlaceholder={t.committee.searchUser}
              loadingLabel={t.committee.loadingUsers}
              emptyLabel={t.committee.noUsers}
              ariaLabel={t.committee.addEvaluator}
            />
          ) : (
            <Button
              variant="secondary"
              onClick={() => setAdding(true)}
              icon={
                <svg className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              }
            >
              {t.committee.addEvaluator}
            </Button>
          )}
        </>
      )}
    </Modal>
  );
}
