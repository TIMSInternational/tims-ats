'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { EVAL360_COMPETENCIES } from '@tims/shared';
import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { toast } from '../../../lib/toast';
import type { Eval360RaterTask } from '../../../lib/trpc-types';

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
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();

  const [ratings, setRatings] = useState<Record<CompetencyKey, number>>(
    () => Object.fromEntries(EVAL360_COMPETENCIES.map((c) => [c, DEFAULT_RATING])) as Record<CompetencyKey, number>,
  );
  const [comment, setComment] = useState('');

  const submit = trpc.evaluation360.submitRatings.useMutation({
    onSuccess: () => {
      toast(t.my360.submitSuccess, { type: 'success' });
      // Refresh myRaterTasks from BOTH read paths: the tRPC cache and — when the C# read cutover is
      // live (NEXT_PUBLIC_EVALUATION360_READ_VIA_CSHARP) — the platform-api query key, which the
      // tRPC invalidate does not reach. Harmless (no-op key) while dark.
      utils.evaluation360.myRaterTasks.invalidate();
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
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
      <div className="flex items-center justify-between mb-1 gap-3">
        <p className="text-[13px] font-semibold text-[#1F114C]">
          {task.subject.firstName} {task.subject.lastName}
        </p>
        <span className="text-[11px] px-2 py-1 rounded-full bg-[#F6F6F6] text-[#585858] font-medium shrink-0">
          {t.my360.relationshipLabels[task.relationship]}
        </span>
      </div>
      <p className="text-[11px] text-[#8B8B8B] mb-4">{task.cycleName}</p>

      <div className="space-y-3">
        {EVAL360_COMPETENCIES.map((competencyKey) => (
          <div key={competencyKey} className="flex items-center justify-between gap-3">
            <label className="text-[12px] text-[#333]">{t.my360.competencyLabels[competencyKey]}</label>
            <div className="flex gap-1" role="radiogroup" aria-label={t.my360.competencyLabels[competencyKey]}>
              {RATING_SCALE.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRatings((r) => ({ ...r, [competencyKey]: n }))}
                  disabled={submit.isPending}
                  aria-pressed={ratings[competencyKey] === n}
                  className={`w-7 h-7 rounded-full text-[11px] font-medium transition disabled:opacity-50 ${
                    ratings[competencyKey] === n
                      ? 'bg-[#1F114C] text-white'
                      : 'bg-[#F6F6F6] text-[#585858] hover:bg-[#EDEDED]'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4">
        <label className="block text-[12px] font-medium text-[#333] mb-1.5">{t.my360.commentLabel}</label>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value.slice(0, 5000))}
          placeholder={t.my360.commentPlaceholder}
          disabled={submit.isPending}
          rows={3}
          className="w-full border border-[#EDEDED] rounded-lg px-3 py-2.5 text-[13px] text-[#333] bg-white focus:outline-none focus:border-[#1F114C]/40 disabled:opacity-50"
        />
      </div>

      <div className="flex justify-end mt-4">
        <button
          type="button"
          onClick={onSubmit}
          disabled={submit.isPending}
          className="h-9 px-4 rounded-lg text-[12px] bg-[#DD0C15] text-white font-medium hover:bg-red-700 transition disabled:opacity-50"
        >
          {submit.isPending ? t.common.saving : t.my360.submitButton}
        </button>
      </div>
    </div>
  );
}
