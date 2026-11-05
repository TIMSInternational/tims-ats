import type { PipelineStageWithApps } from '../../../../lib/trpc-types';
import { getPipelineFit } from '../../../../lib/pipeline-fit';
import { wholeDaysSince } from '../../../../lib/pipeline-days';
import { isActionableApplication } from './pipeline-actions';

function hoursAgo(date: Date | string): number {
  const d = typeof date === 'string' ? new Date(date) : date;
  return Math.max(0, (Date.now() - d.getTime()) / 3600000);
}

export interface FlatApp {
  id: string;
  candidateId: string;
  name: string;
  firstName: string;
  lastName: string;
  avatar: string | null;
  currentTitle: string | null;
  source: string;
  status: string;
  actionable: boolean;
  stageName: string;
  stageOrder: number;
  stageId: string;
  slaHours: number | null;
  fitScore: number | null;
  isPartialFit: boolean;
  /** Whole days in the CURRENT stage (A-23), the same clock as the SLA and the "Días en etapa" filter. */
  days: number;
  isOverdue: boolean;
}

/** One row per application, in stage order, with the derived values the table sorts and shows. */
export function flattenBoard(stages: PipelineStageWithApps[]): FlatApp[] {
  const result: FlatApp[] = [];
  for (const stage of stages) {
    for (const app of stage.applications) {
      const c = app.candidate;
      const fit = getPipelineFit(app.candidate);
      const actionable = isActionableApplication(app);
      result.push({
        id: app.id,
        candidateId: c.id,
        name: `${c.firstName} ${c.lastName}`,
        firstName: c.firstName,
        lastName: c.lastName,
        avatar: c.avatar,
        currentTitle: c.currentTitle ?? null,
        source: app.source,
        status: app.status,
        actionable,
        stageName: stage.name,
        stageOrder: stage.order,
        stageId: stage.id,
        slaHours: stage.slaHours,
        fitScore: fit?.score ?? null,
        isPartialFit: fit?.isPartial ?? false,
        days: wholeDaysSince(app.enteredStageAt),
        // SLA overdue is time-in-CURRENT-stage and uses precise hours so sub-24h SLAs can trigger same-day.
        isOverdue: actionable && stage.slaHours != null && hoursAgo(app.enteredStageAt) > stage.slaHours,
      });
    }
  }
  return result;
}
