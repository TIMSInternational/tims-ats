'use client';

import { useState } from 'react';
import { useI18n } from '../../../../../lib/i18n';
import { toast } from '../../../../../lib/toast';
import { useGradeEssay, type PendingEssay } from '../../../../../lib/platform-api/fit-engine';

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
  const grade = useGradeEssay(assignmentId, { onError: () => toast(t.candidates.essayGradeError, { type: 'error' }) });
  const max = String(essay.maxPoints);
  const value = Number(points);
  const valid = points !== '' && Number.isFinite(value) && value >= 0 && value <= essay.maxPoints;

  const submit = () => {
    if (!valid) {
      toast(t.candidates.essayInvalidPoints.replace('{max}', max), { type: 'error' });
      return;
    }
    grade.mutate(
      { questionId: essay.questionId, points: value },
      { onSuccess: () => toast(t.candidates.essayGraded, { type: 'success' }) },
    );
  };

  return (
    <div className="border border-[#EDEDED] rounded-lg p-3 space-y-2" data-testid="essay-grade-row">
      <p className="text-[12px] font-medium text-[#1F114C] whitespace-pre-wrap">{essay.prompt}</p>
      <p className="text-[12px] text-[#585858] whitespace-pre-wrap bg-[#F6F6F6] rounded p-2">{essay.answer}</p>
      {canGrade && (
        <div className="flex items-end gap-2">
          <label className="text-[11px] text-[#585858]">
            {t.candidates.essayPointsLabel.replace('{max}', max)}
            <input
              type="number"
              min={0}
              max={essay.maxPoints}
              step="0.5"
              value={points}
              onChange={(e) => setPoints(e.target.value)}
              className="block w-24 mt-1 bg-white border border-[#EDEDED] rounded-lg px-2 h-8 text-[12px] text-[#333]"
            />
          </label>
          <button
            type="button"
            onClick={submit}
            disabled={grade.isPending}
            className="bg-[#1F114C] text-white px-3 h-8 rounded-lg text-[12px] font-medium disabled:opacity-50"
          >
            {grade.isPending ? t.candidates.essayGrading : t.candidates.essayGradeButton}
          </button>
        </div>
      )}
    </div>
  );
}
