'use client';

import { useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { EVAL360_COMPETENCIES } from '@tims/shared';
import { useI18n } from '../../../lib/i18n';
import { Button, Field, StatusBadge, TextArea } from '../../../components';
import { toast } from '../../../lib/toast';
import type { Eval360RaterTask } from '../../../lib/trpc-types';
import { useEvaluation360SubmitRatings } from '../../../lib/platform-api/evaluation360';

type CompetencyKey = (typeof EVAL360_COMPETENCIES)[number];

const RATING_SCALE = [1, 2, 3, 4, 5] as const;
const DEFAULT_RATING = 3;

interface RaterTaskCardProps {
  task: Eval360RaterTask;
}

/** One pending rater task: 6 competency 1-5 selectors + an optional comment,
 * submitted via evaluation360.submitRatings (must send all 6 competencies —
 * enforced both by the zod boundary and by always sending the fixed set here). */
export function RaterTaskCard({ task }: RaterTaskCardProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const scaleHintId = useId();
  const groupName = useId();

  const [ratings, setRatings] = useState<Record<CompetencyKey, number>>(
    () => Object.fromEntries(EVAL360_COMPETENCIES.map((c) => [c, DEFAULT_RATING])) as Record<CompetencyKey, number>,
  );
  const [comment, setComment] = useState('');

  const submit = useEvaluation360SubmitRatings({
    onSuccess: () => {
      toast(t.my360.submitSuccess, { type: 'success' });
      queryClient.invalidateQueries({ queryKey: ['platform-api', 'evaluation360', 'my-rater-tasks'] });
    },
    onError: (err) => toast(err.message, { type: 'error' }),
  });

  const onSubmit = () => {
    const trimmedComment = comment.trim();
    submit.mutate({
      assignmentId: task.assignmentId,
      ratings: EVAL360_COMPETENCIES.map((competencyKey) => ({
        competencyKey,
        rating: ratings[competencyKey],
        ...(trimmedComment ? { comment: trimmedComment } : {}),
      })),
    });
  };

  return (
    <article className="rounded-xl border border-border bg-white p-4 shadow-card md:p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-subheading font-semibold text-primary">
          {task.subject.firstName} {task.subject.lastName}
        </h3>
        <StatusBadge tone="neutral" icon="none" className="shrink-0">
          {t.my360.relationshipLabels[task.relationship]}
        </StatusBadge>
      </div>
      <p className="text-callout text-secondary">{task.cycleName}</p>
      <p id={scaleHintId} className="mb-4 mt-1 text-callout text-secondary">
        {t.my360.scaleHint}
      </p>

      <div className="space-y-3">
        {EVAL360_COMPETENCIES.map((competencyKey) => (
          // A real radio group: a fieldset named by its legend, five native radios (arrow keys work).
          <fieldset
            key={competencyKey}
            aria-describedby={scaleHintId}
            disabled={submit.isPending}
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2"
          >
            <legend className="float-left text-body text-primary">{t.my360.competencyLabels[competencyKey]}</legend>
            <div className="flex gap-1.5">
              {RATING_SCALE.map((n) => (
                <label key={n} className="relative cursor-pointer">
                  <input
                    type="radio"
                    name={`${groupName}-${competencyKey}`}
                    value={n}
                    checked={ratings[competencyKey] === n}
                    onChange={() => setRatings((r) => ({ ...r, [competencyKey]: n }))}
                    className="peer sr-only"
                  />
                  <span
                    aria-hidden="true"
                    className="flex size-9 items-center justify-center rounded-full bg-surface text-callout font-medium text-secondary transition-colors duration-150 hover:bg-border peer-checked:bg-brand peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand peer-disabled:opacity-50 pointer-coarse:size-11"
                  >
                    {n}
                  </span>
                  <span className="sr-only">{n}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>

      <Field label={t.my360.commentLabel} className="mt-4">
        <TextArea
          value={comment}
          onChange={(e) => setComment(e.target.value.slice(0, 5000))}
          placeholder={t.my360.commentPlaceholder}
          disabled={submit.isPending}
          rows={3}
        />
      </Field>

      <div className="mt-4 flex justify-end">
        <Button onClick={onSubmit} loading={submit.isPending} loadingLabel={t.common.saving} disabled={submit.isPending}>
          {t.my360.submitButton}
        </Button>
      </div>
    </article>
  );
}
