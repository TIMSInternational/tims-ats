'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RATER_RELATIONSHIPS, type RaterRelationshipValue } from '@tims/shared';
import { useI18n, formatMessage } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { Button, Field, FIELD_LABEL_CLASSES, Select, UserPicker } from '../../../../components';
import type { PickedUser } from '../../../../components/user-picker';
import { useEvaluation360AssignRaters } from '../../../../lib/platform-api/evaluation360';

interface RaterRow {
  user: PickedUser;
  relationship: RaterRelationshipValue;
}

interface AssignRatersFormProps {
  cycleId: string;
  /** Reports unsaved rater rows so the modal can confirm before closing. */
  onDirtyChange?: (dirty: boolean) => void;
}

/** Builds a batch of {subjectUserId, raterUserId, relationship} rows for ONE
 * subject and submits them via evaluation360.assignRaters in a single call. */
export function AssignRatersForm({ cycleId, onDirtyChange }: AssignRatersFormProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  const [subject, setSubject] = useState<PickedUser | null>(null);
  const [rows, setRows] = useState<RaterRow[]>([]);
  const [pickingRater, setPickingRater] = useState(false);

  useEffect(() => {
    onDirtyChange?.(rows.length > 0);
  }, [rows.length, onDirtyChange]);

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
    <section aria-labelledby={`assign-${cycleId}`}>
      <h3 id={`assign-${cycleId}`} className="mb-2.5 text-subheading font-semibold text-brand">
        {t.evaluation360.assignRatersTitle}
      </h3>

      {/* Subject */}
      <div className="mb-4">
        {subject ? (
          <>
            <p className={FIELD_LABEL_CLASSES}>{t.evaluation360.subjectLabel}</p>
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
              <span className="text-body font-medium text-primary">
                {subject.firstName} {subject.lastName}
              </span>
              <Button variant="tertiary" size="sm" onClick={resetSubject} disabled={assignRaters.isPending}>
                {t.evaluation360.changeSubjectButton}
              </Button>
            </div>
          </>
        ) : (
          <Field label={t.evaluation360.subjectLabel} help={t.evaluation360.selectSubjectPrompt}>
            {(control) => (
              <UserPicker
                purpose="evaluation360_participant"
                inputId={control.id}
                onSelect={(_id, user) => setSubject(user)}
                searchPlaceholder={t.evaluation360.searchSubjectPlaceholder}
                loadingLabel={t.evaluation360.loadingUsers}
                emptyLabel={t.evaluation360.noUsersFound}
              />
            )}
          </Field>
        )}
      </div>

      {subject && (
        <>
          {/* Rater rows */}
          {rows.length > 0 && (
            <ul className="mb-3 space-y-2">
              {rows.map((row, idx) => {
                const name = `${row.user.firstName} ${row.user.lastName}`;
                return (
                  <li key={`${row.user.id}-${idx}`} className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 text-body text-primary">{name}</span>
                    <div className="w-full sm:w-44">
                      <Select
                        value={row.relationship}
                        onChange={(e) => updateRelationship(idx, e.target.value as RaterRelationshipValue)}
                        disabled={assignRaters.isPending}
                        aria-label={formatMessage(t.evaluation360.relationshipFor, { name })}
                      >
                        {RATER_RELATIONSHIPS.map((rel) => (
                          <option key={rel} value={rel}>
                            {t.evaluation360.relationshipLabels[rel]}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <Button
                      variant="tertiary"
                      size="sm"
                      onClick={() => removeRow(idx)}
                      disabled={assignRaters.isPending}
                    >
                      {t.evaluation360.removeRaterButton}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}

          {pickingRater ? (
            <UserPicker
              purpose="evaluation360_participant"
              excludeIds={rows.map((r) => r.user.id)}
              onSelect={addRater}
              disabled={assignRaters.isPending}
              ariaLabel={t.evaluation360.raterLabel}
              autoFocus
              searchPlaceholder={t.evaluation360.searchRaterPlaceholder}
              loadingLabel={t.evaluation360.loadingUsers}
              emptyLabel={t.evaluation360.noUsersFound}
            />
          ) : (
            <Button
              variant="tertiary"
              size="sm"
              onClick={() => setPickingRater(true)}
              disabled={assignRaters.isPending}
            >
              + {t.evaluation360.addRaterButton}
            </Button>
          )}

          {rows.length === 0 && (
            <p className="mt-2 text-callout text-secondary">{t.evaluation360.assignmentsEmptyHint}</p>
          )}

          <div className="mt-4 flex justify-end">
            <Button
              onClick={onSubmit}
              disabled={assignRaters.isPending || rows.length === 0}
              loading={assignRaters.isPending}
              loadingLabel={t.common.saving}
            >
              {t.evaluation360.assignSubmitButton}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
