'use client';

import { useState } from 'react';
import { useI18n } from '../../../../../lib/i18n';
import { toast } from '../../../../../lib/toast';
import { useGradeEssay, type PendingEssay } from '../../../../../lib/platform-api/fit-engine';
import { Button, FIELD_ERROR_CLASSES, inputClasses } from '../../../../../components';

/** One essay awaiting a grade: prompt, the candidate's answer (plain text), and a points control. */
export function EssayGradeRow({
  assignmentId,
  essay,
  canGrade,
}: {
  assignmentId: string;
  essay: PendingEssay;
  canGrade: boolean;
}) {
  const { t } = useI18n();
  const [points, setPoints] = useState('');
  const [showError, setShowError] = useState(false);
  const grade = useGradeEssay(assignmentId, { onError: () => toast(t.candidates.essayGradeError, { type: 'error' }) });
  const max = String(essay.maxPoints);
  const value = Number(points);
  const valid = points !== '' && Number.isFinite(value) && value >= 0 && value <= essay.maxPoints;
  const inputId = `essay-points-${assignmentId}-${essay.questionId}`;
  const errorId = `${inputId}-error`;
  const invalid = showError && !valid;

  const submit = () => {
    // The range error belongs under the points field, not in a toast (writing.md › Best practices).
    if (!valid) {
      setShowError(true);
      return;
    }
    grade.mutate(
      { questionId: essay.questionId, points: value },
      { onSuccess: () => toast(t.candidates.essayGraded, { type: 'success' }) },
    );
  };

  return (
    <div className="space-y-2 rounded-lg border border-border p-3" data-testid="essay-grade-row">
      <p className="whitespace-pre-wrap text-body font-medium text-brand">{essay.prompt}</p>
      <p className="whitespace-pre-wrap rounded bg-surface p-2 text-body text-primary">{essay.answer}</p>
      {canGrade && (
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor={inputId} className="block text-callout text-secondary">
              {t.candidates.essayPointsLabel.replace('{max}', max)}
            </label>
            <input
              id={inputId}
              type="number"
              min={0}
              max={essay.maxPoints}
              step="0.5"
              value={points}
              onChange={(e) => setPoints(e.target.value)}
              onBlur={() => setShowError(points !== '')}
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? errorId : undefined}
              className={inputClasses('md', 'mt-1 w-28')}
            />
          </div>
          <Button size="sm" onClick={submit} loading={grade.isPending} loadingLabel={t.candidates.essayGrading}>
            {t.candidates.essayGradeButton}
          </Button>
          {invalid && (
            <p id={errorId} role="alert" className={`${FIELD_ERROR_CLASSES} w-full`}>
              {t.candidates.essayInvalidPoints.replace('{max}', max)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
