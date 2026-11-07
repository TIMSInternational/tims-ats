'use client';

import { toast } from './toast';
import {
  isHiredStageName,
  getNextActionForStage,
  visibleNextAction,
  type NextAction,
  type NextActionContext,
} from './pipeline-next-actions';

export interface StageMoveToastLabels {
  moved: string;
  checklistIncompleteWarning: string;
  /** Shown after a manual move to the final "Contratado" stage: the move does not record the hire. */
  hiredStageHint: string;
  nextAction: Record<NextAction['labelKey'], string>;
}

/**
 * The feedback after a stage move, the same from the board and from the Candidate 360 (A-13):
 * - a warning naming the source stage's checklist items still open (the move always succeeds);
 * - a success toast with the suggested next step for the destination stage, when the viewer can follow it;
 * - otherwise the bare "Candidato movido";
 * - after a move to "Contratado", a hint that the hire is only confirmed with "Autorizar Contratación" on the
 *   accepted offer (hire-closure.service.ts): the stage alone does not mark the application hired.
 */
export function announceStageMove(
  result: { warnings?: string[] | null },
  destinationStageName: string | null | undefined,
  labels: StageMoveToastLabels,
  context: NextActionContext,
): void {
  const warnings = result.warnings ?? [];
  if (warnings.length > 0) {
    toast(`${labels.moved} ${labels.checklistIncompleteWarning.replace('{items}', warnings.join(', '))}`, {
      type: 'warning',
    });
  }
  const nextAction = destinationStageName
    ? visibleNextAction(getNextActionForStage(destinationStageName), undefined, context)
    : null;
  if (nextAction) {
    toast(labels.moved, {
      type: 'success',
      action: { label: labels.nextAction[nextAction.labelKey], href: nextAction.href },
    });
  } else if (warnings.length === 0) {
    toast(labels.moved, { type: 'success' });
  }
  if (destinationStageName && isHiredStageName(destinationStageName)) {
    toast(labels.hiredStageHint, { type: 'info', duration: 8000 });
  }
}
