'use client';

import { useState } from 'react';
import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import { pluralize } from '../../../../../lib/i18n/format';
import { selectClasses } from '../../../../../components';
import { CARD, CARD_TITLE } from './card-styles';
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

// The dot is decoration: every step also says in words whether it was reached, is current or is pending.
const DOT: Record<StageStep['state'], string> = {
  reached: 'bg-success',
  current: 'bg-brand ring-2 ring-brand/30',
  pending: 'border border-field-border bg-white',
};
const NAME: Record<StageStep['state'], string> = {
  reached: 'text-primary',
  current: 'text-brand',
  pending: 'text-muted',
};

/** The application's process through its vacancy's real stages, with the dates it entered each one (A-03). */
export function StageTimeline({ applications }: { applications: Application[] }) {
  const { t, locale } = useI18n();
  const ordered = [...applications].sort(
    (a, b) =>
      Number(b.status === 'active') - Number(a.status === 'active') ||
      new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime(),
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
      if (app.status === 'rejected')
        return c.stageEndedRejected.replace('{date}', app.rejectedAt ? formatDate(app.rejectedAt) : '—');
      if (app.status === 'hired') return c.stageEndedHired;
      return step.enteredAt ? c.stageCurrentSince.replace('{date}', formatDate(step.enteredAt)) : c.stageCurrent;
    }
    if (step.state === 'pending') return c.stageNotReached;
    return step.enteredAt ? c.stageEnteredOn.replace('{date}', formatDate(step.enteredAt)) : null;
  };

  return (
    <section className={CARD}>
      <h2 className={`${CARD_TITLE} mb-1`}>{c.processTimeline}</h2>
      {ordered.length > 1 ? (
        <div className="mb-3">
          <label htmlFor={`stage-timeline-app-${app.id}`} className="sr-only">
            {c.stageModalVacancy}
          </label>
          <select
            id={`stage-timeline-app-${app.id}`}
            value={app.id}
            onChange={(e) => setSelectedId(e.target.value)}
            className={selectClasses('md', 'mt-1')}
          >
            {ordered.map((a) => (
              <option key={a.id} value={a.id}>
                {a.vacancy.title}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <p className="mb-3 text-callout text-secondary">
          {c.processTimelineFor.replace('{vacancy}', app.vacancy.title)}
        </p>
      )}
      <p className="mb-3 text-callout text-secondary">
        {c.stageAppliedVia
          .replace('{date}', formatDate(app.appliedAt))
          .replace('{source}', candidateSourceLabel(app.source, c))}
      </p>
      {loadError ? (
        <div className="space-y-1">
          <p className="text-body font-medium text-brand">
            {app.currentStage.name} · {c.stageCurrent}
          </p>
          <p role="alert" className="text-callout text-secondary">
            {loadError}
          </p>
        </div>
      ) : !steps ? (
        <div className="h-24 animate-pulse rounded-lg bg-surface" aria-hidden="true" />
      ) : (
        <ol>
          {steps.map((step, i) => {
            const isLast = i === steps.length - 1;
            const ended = step.state === 'current' && app.status === 'rejected';
            const note = stepNote(step);
            return (
              <li key={step.id} className="flex gap-3" aria-current={step.state === 'current' ? 'step' : undefined}>
                <div className="flex flex-col items-center" aria-hidden="true">
                  <div className={`mt-1 size-3 shrink-0 rounded-full ${ended ? 'bg-danger' : DOT[step.state]}`} />
                  {!isLast && <div className="h-8 w-0.5 bg-border" />}
                </div>
                <div className="pb-1">
                  <p className={`text-body font-medium ${ended ? 'text-danger' : NAME[step.state]}`}>{step.name}</p>
                  {note && <p className="text-callout text-secondary">{note}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <p className="mt-3 border-t border-border pt-3 text-callout text-secondary">
        {c.totalTimeInProcess}{' '}
        <span className="font-medium text-brand">
          {pluralize(totalDays, { one: c.daysOne, other: c.daysOther }, locale)}
        </span>
      </p>
    </section>
  );
}
