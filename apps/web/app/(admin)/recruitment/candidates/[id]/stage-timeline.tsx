'use client';

import { useState } from 'react';
import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import { formatDate } from '../../../../../lib/format-utils';
import { candidateSourceLabel } from '../../../../../lib/candidate-labels';
import { wholeDaysSince } from '../../../../../lib/pipeline-days';
import { buildStageSteps, type StageStep } from './stage-steps';

interface Application {
  id: string;
  status: string;
  source: string;
  appliedAt: Date | string;
  rejectedAt?: Date | string | null;
  vacancy: { id: string; title: string; status: string };
  currentStage: { id: string; name: string; order: number };
}

const DOT: Record<StageStep['state'], string> = {
  reached: 'bg-green-500',
  current: 'bg-[#7B6BAA] ring-2 ring-[#7B6BAA]/30',
  pending: 'bg-[#EDEDED]',
};

/** The application's process through its vacancy's real stages, with the dates it entered each one (A-03). */
export function StageTimeline({ applications }: { applications: Application[] }) {
  const { t } = useI18n();
  const ordered = [...applications].sort(
    (a, b) => Number(b.status === 'active') - Number(a.status === 'active') || new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime(),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const app = ordered.find((a) => a.id === selectedId) ?? ordered[0];
  const stages = trpc.pipeline.listStages.useQuery({ vacancyId: app?.vacancy.id ?? '' }, { enabled: !!app });
  const history = trpc.pipeline.getMovementHistory.useQuery({ applicationId: app?.id ?? '' }, { enabled: !!app });

  if (!app) return null;
  const c = t.candidates;
  // Both reads must succeed: without the movement history, dates and "not reached" would be guesses (Codex P2).
  const steps = stages.data && history.data ? buildStageSteps(stages.data, history.data, app) : null;
  const loadError = stages.isError ? c.stagesLoadError : history.isError ? c.historyLoadError : null;
  const totalDays = Math.max(1, wholeDaysSince(app.appliedAt));

  const stepNote = (step: StageStep): string | null => {
    if (step.state === 'current') {
      if (app.status === 'rejected') return c.stageEndedRejected.replace('{date}', app.rejectedAt ? formatDate(app.rejectedAt) : '—');
      if (app.status === 'hired') return c.stageEndedHired;
      return step.enteredAt ? c.stageCurrentSince.replace('{date}', formatDate(step.enteredAt)) : c.stageCurrent;
    }
    if (step.state === 'pending') return c.stageNotReached;
    return step.enteredAt ? c.stageEnteredOn.replace('{date}', formatDate(step.enteredAt)) : null;
  };

  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h3 className="text-[14px] font-semibold text-[#1F114C] mb-1">{c.processTimeline}</h3>
      {ordered.length > 1 ? (
        <label className="block mb-3 text-[11px] text-[#8B8B8B]">
          <span className="sr-only">{c.tabApplications}</span>
          <select
            value={app.id}
            onChange={(e) => setSelectedId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-[#EDEDED] bg-white p-1.5 text-[12px] text-[#333]"
          >
            {ordered.map((a) => (
              <option key={a.id} value={a.id}>
                {a.vacancy.title}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="text-[11px] text-[#8B8B8B] mb-3">{c.processTimelineFor.replace('{vacancy}', app.vacancy.title)}</p>
      )}
      <p className="text-[11px] text-[#585858] mb-3">
        {c.stageAppliedVia.replace('{date}', formatDate(app.appliedAt)).replace('{source}', candidateSourceLabel(app.source, c))}
      </p>
      {loadError ? (
        <div className="space-y-1">
          <p className="text-[12px] font-medium text-[#7B6BAA]">
            {app.currentStage.name} · {c.stageCurrent}
          </p>
          <p role="alert" className="text-[11px] text-[#8B8B8B]">{loadError}</p>
        </div>
      ) : !steps ? (
        <div className="h-24 animate-pulse rounded-lg bg-[#F6F6F6]" />
      ) : (
        <ol className="space-y-0">
          {steps.map((step, i) => {
            const isLast = i === steps.length - 1;
            const ended = step.state === 'current' && app.status === 'rejected';
            const note = stepNote(step);
            return (
              <li key={step.id} className="flex gap-3" aria-current={step.state === 'current' ? 'step' : undefined}>
                <div className="flex flex-col items-center">
                  <div className={`w-3 h-3 rounded-full ${ended ? 'bg-red-500' : DOT[step.state]} mt-1 shrink-0`} />
                  {!isLast && <div className="w-0.5 h-8 bg-[#EDEDED]" />}
                </div>
                <div className="pb-1">
                  <p
                    className={`text-[12px] font-medium ${
                      step.state === 'current' ? (ended ? 'text-red-600' : 'text-[#7B6BAA]') : step.state === 'reached' ? 'text-[#333]' : 'text-[#8B8B8B]'
                    }`}
                  >
                    {step.name}
                  </p>
                  {note && <p className="text-[11px] text-[#8B8B8B]">{note}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <p className="text-[11px] text-[#585858] mt-3 border-t border-[#F0F0F0] pt-3">
        {c.totalTimeInProcess} <span className="font-medium text-[#1F114C]">{totalDays} {c.days}</span>
      </p>
    </div>
  );
}
