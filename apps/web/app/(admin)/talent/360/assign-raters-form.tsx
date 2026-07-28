'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RATER_RELATIONSHIPS, type RaterRelationshipValue } from '@tims/shared';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { UserPicker } from '../../../../components';
import type { PickedUser } from '../../../../components/user-picker';
import { useEvaluation360AssignRaters } from '../../../../lib/platform-api/evaluation360';

interface RaterRow {
  user: PickedUser;
  relationship: RaterRelationshipValue;
}

interface AssignRatersFormProps {
  cycleId: string;
}

/** Builds a batch of {subjectUserId, raterUserId, relationship} rows for ONE
 * subject and submits them via evaluation360.assignRaters in a single call. */
export function AssignRatersForm({ cycleId }: AssignRatersFormProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  const [subject, setSubject] = useState<PickedUser | null>(null);
  const [rows, setRows] = useState<RaterRow[]>([]);
  const [pickingRater, setPickingRater] = useState(false);

  const assignRaters = useEvaluation360AssignRaters({
    onSuccess: () => {
      toast(t.evaluation360.assignSuccess, { type: 'success' });
      queryClient.invalidateQueries({
        queryKey: ['platform-api', 'evaluation360', 'cycle-progress', cycleId],
      });
      setRows([]);
    },
    onError: (err) => toast(err.message, { type: 'error' }),
  });

  const resetSubject = () => {
    setSubject(null);
    setRows([]);
  };

  const addRater = (_userId: string, user: PickedUser) => {
    setRows((prev) => [...prev, { user, relationship: 'peer' }]);
    setPickingRater(false);
  };

  const updateRelationship = (idx: number, relationship: RaterRelationshipValue) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, relationship } : r)));
  };

  const removeRow = (idx: number) => setRows((prev) => prev.filter((_, i) => i !== idx));

  const onSubmit = () => {
    if (!subject || rows.length === 0) return;
    assignRaters.mutate({
      cycleId,
      assignments: rows.map((r) => ({
        subjectUserId: subject.id,
        raterUserId: r.user.id,
        relationship: r.relationship,
      })),
    });
  };

  return (
    <div>
      <h3 className="text-[12px] font-semibold text-[#1F114C] mb-2.5">{t.evaluation360.assignRatersTitle}</h3>

      {/* Subject */}
      <div className="mb-4">
        <label className="block text-[11px] font-medium text-[#585858] mb-1.5">{t.evaluation360.subjectLabel}</label>
        {subject ? (
          <div className="flex items-center justify-between border border-[#EDEDED] rounded-lg px-3 py-2.5">
            <span className="text-[12px] text-[#333] font-medium">
              {subject.firstName} {subject.lastName}
            </span>
            <button
              type="button"
              onClick={resetSubject}
              disabled={assignRaters.isPending}
              className="text-[11px] text-[#DD0C15] hover:underline disabled:opacity-50"
            >
              {t.evaluation360.changeSubjectButton}
            </button>
          </div>
        ) : (
          <>
            <p className="text-[11px] text-[#8B8B8B] mb-1.5">{t.evaluation360.selectSubjectPrompt}</p>
            <UserPicker
              onSelect={(_id, user) => setSubject(user)}
              searchPlaceholder={t.evaluation360.searchSubjectPlaceholder}
              loadingLabel={t.evaluation360.loadingUsers}
              emptyLabel={t.evaluation360.noUsersFound}
            />
          </>
        )}
      </div>

      {subject && (
        <>
          {/* Rater rows */}
          <div className="space-y-2 mb-3">
            {rows.map((row, idx) => (
              <div key={`${row.user.id}-${idx}`} className="flex items-center gap-2">
                <span className="flex-1 text-[12px] text-[#333]">
                  {row.user.firstName} {row.user.lastName}
                </span>
                <select
                  value={row.relationship}
                  onChange={(e) => updateRelationship(idx, e.target.value as RaterRelationshipValue)}
                  disabled={assignRaters.isPending}
                  className="border border-[#EDEDED] rounded-lg px-2 h-8 text-[11px] text-[#333] bg-white disabled:opacity-50"
                >
                  {RATER_RELATIONSHIPS.map((rel) => (
                    <option key={rel} value={rel}>
                      {t.evaluation360.relationshipLabels[rel]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => removeRow(idx)}
                  disabled={assignRaters.isPending}
                  className="text-[11px] text-[#DD0C15] hover:underline disabled:opacity-50 shrink-0"
                >
                  {t.evaluation360.removeRaterButton}
                </button>
              </div>
            ))}
          </div>

          {pickingRater ? (
            <UserPicker
              excludeIds={rows.map((r) => r.user.id)}
              onSelect={addRater}
              disabled={assignRaters.isPending}
              searchPlaceholder={t.evaluation360.searchRaterPlaceholder}
              loadingLabel={t.evaluation360.loadingUsers}
              emptyLabel={t.evaluation360.noUsersFound}
            />
          ) : (
            <button
              type="button"
              onClick={() => setPickingRater(true)}
              disabled={assignRaters.isPending}
              className="text-[12px] text-[#1F114C] hover:underline disabled:opacity-50"
            >
              + {t.evaluation360.addRaterButton}
            </button>
          )}

          {rows.length === 0 && (
            <p className="text-[11px] text-[#8B8B8B] mt-2">{t.evaluation360.assignmentsEmptyHint}</p>
          )}

          <div className="flex justify-end mt-4">
            <button
              type="button"
              onClick={onSubmit}
              disabled={assignRaters.isPending || rows.length === 0}
              className="h-9 px-4 rounded-lg text-[12px] bg-[#DD0C15] text-white font-medium hover:bg-red-700 transition disabled:opacity-50"
            >
              {assignRaters.isPending ? t.common.saving : t.evaluation360.assignSubmitButton}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
