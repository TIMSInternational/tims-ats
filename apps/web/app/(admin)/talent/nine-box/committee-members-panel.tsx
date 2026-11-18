'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { Button, CandidateAvatar, EmptyState, ErrorState, Skeleton, UserPicker } from '../../../../components';
import {
  useNineBoxCalibration,
  useNineBoxAddCalibrationMember,
  useNineBoxRemoveCalibrationMember,
  invalidateNineboxPlatformReads,
} from '../../../../lib/platform-api/ninebox';

interface CommitteeMembersPanelProps {
  sessionId: string;
}

/**
 * Committee-membership manager for a single calibration session.
 * Reads the calibration via `useNineBoxCalibration`; add/remove via
 * addCalibrationMember / removeCalibrationMember, invalidating the C# nine-box
 * reads (including this session) on success. Self-contained — mount it
 * anywhere a sessionId is in scope. Removal is an inline two-step on the row
 * (no window.confirm on top of the modal).
 */
export function CommitteeMembersPanel({ sessionId }: CommitteeMembersPanelProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [confirmingUserId, setConfirmingUserId] = useState<string | null>(null);

  const calibration = useNineBoxCalibration(sessionId);

  const invalidate = () => {
    invalidateNineboxPlatformReads(queryClient);
  };

  const add = useNineBoxAddCalibrationMember({
    onSuccess: () => {
      toast(t.committee.added, { type: 'success' });
      setAdding(false);
      invalidate();
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
    },
  });

  const remove = useNineBoxRemoveCalibrationMember({
    onSuccess: () => {
      toast(t.committee.removed, { type: 'success' });
      setConfirmingUserId(null);
      invalidate();
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
    },
  });

  const memberRows = calibration.data?.members ?? [];
  const assignedIds = memberRows.map((m) => m.user.id);

  return (
    <section aria-labelledby={`committee-${sessionId}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 id={`committee-${sessionId}`} className="text-subheading font-semibold text-brand">
          {t.committee.members}
        </h3>
        {!adding && (
          <Button
            variant="tertiary"
            size="sm"
            onClick={() => setAdding(true)}
            icon={
              <svg
                className="size-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            }
          >
            {t.committee.addMember}
          </Button>
        )}
      </div>

      {calibration.isLoading ? (
        <div aria-busy="true" className="space-y-1.5">
          <span className="sr-only">{t.common.loadingContent}</span>
          <Skeleton className="h-11 w-full rounded-lg" />
          <Skeleton className="h-11 w-full rounded-lg" />
        </div>
      ) : calibration.isError ? (
        <ErrorState
          size="compact"
          title={t.committee.loadError}
          error={calibration.error}
          onRetry={() => calibration.refetch()}
        />
      ) : (
        <>
          {memberRows.length === 0 ? (
            <EmptyState size="compact" title={t.committee.noMembers} />
          ) : (
            <ul className="mb-3 space-y-1.5">
              {memberRows.map((m) => {
                const confirming = confirmingUserId === m.user.id;
                return (
                  <li
                    key={m.id}
                    className="flex flex-wrap items-center gap-2.5 rounded-lg border border-border px-3 py-2"
                  >
                    <CandidateAvatar
                      firstName={m.user.firstName}
                      lastName={m.user.lastName}
                      avatar={m.user.avatar}
                      size="sm"
                      decorative
                    />
                    <span className="flex-1 text-body font-medium text-primary">
                      {m.user.firstName} {m.user.lastName}
                    </span>
                    {confirming ? (
                      <span
                        className="flex flex-wrap items-center gap-2"
                        role="group"
                        aria-label={t.committee.removeConfirm}
                      >
                        <span className="text-callout text-secondary">{t.committee.removeConfirm}</span>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setConfirmingUserId(null)}
                          disabled={remove.isPending}
                        >
                          {t.common.cancel}
                        </Button>
                        <Button
                          variant="destructive-secondary"
                          size="sm"
                          onClick={() => remove.mutate({ sessionId, userId: m.user.id })}
                          loading={remove.isPending}
                          loadingLabel={t.committee.removing}
                          autoFocus
                        >
                          {t.committee.remove}
                        </Button>
                      </span>
                    ) : (
                      <Button
                        variant="destructive-secondary"
                        size="sm"
                        onClick={() => setConfirmingUserId(m.user.id)}
                        disabled={remove.isPending}
                      >
                        {t.committee.remove}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {adding && (
            <UserPicker
              purpose="ninebox_committee_member"
              excludeIds={assignedIds}
              disabled={add.isPending}
              ariaLabel={t.committee.addMember}
              autoFocus
              onSelect={(userId) => add.mutate({ sessionId, userId })}
              searchPlaceholder={t.committee.searchUser}
              loadingLabel={t.committee.loadingUsers}
              emptyLabel={t.committee.noUsers}
            />
          )}
        </>
      )}
    </section>
  );
}
