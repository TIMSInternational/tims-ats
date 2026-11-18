'use client';

import { useI18n } from '../../../../../lib/i18n';
import { useCan } from '../../../../../lib/permissions';
import { isFitEngineV2Enabled, usePendingEssays } from '../../../../../lib/platform-api/fit-engine';
import { EssayGradeRow } from './essay-grade-row';

/**
 * Owner default D5: the essays of a completed native quiz that still await a grade, shown to recruiters, with a
 * grade control for holders of assessment:update. Renders nothing unless FIT v2 is on and something is pending (a
 * caller without assessment:read gets a 403 from C#, which also renders nothing).
 */
export function EssayGradingPanel({ assignmentId }: { assignmentId: string }) {
  const { t } = useI18n();
  const can = useCan();
  const enabled = isFitEngineV2Enabled();
  const essays = usePendingEssays(assignmentId, enabled);

  if (!enabled || !essays.data || essays.data.length === 0) return null;

  const canGrade = can('assessment', 'update');
  return (
    <div className="mt-2 space-y-2" data-testid="essay-grading-panel">
      <p className="text-[11px] font-semibold text-amber-700">{t.candidates.essayGradingTitle}</p>
      {essays.data.map((essay) => (
        <EssayGradeRow key={essay.questionId} assignmentId={assignmentId} essay={essay} canGrade={canGrade} />
      ))}
    </div>
  );
}
