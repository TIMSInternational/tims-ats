'use client';

import { toast } from './toast';
import {
  getNextActionForStage,
  visibleNextAction,
  type NextAction,
  type NextActionContext,
} from './pipeline-next-actions';

export interface StageMoveToastLabels {
  moved: string;
  checklistIncompleteWarning: string;
  nextAction: Record<NextAction['labelKey'], string>;
}

/**
 * The feedback after a stage move, the same from the board and from the Candidate 360 (A-13):
 * - a warning naming the source stage's checklist items still open (the move always succeeds);
 * - a success toast with the suggested next step for the destination stage, when the viewer can follow it;
 * - otherwise the bare "Candidato movido".
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
}
