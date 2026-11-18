'use client';

import { CandidateAvatar } from '../../../../components';
import { useI18n } from '../../../../lib/i18n';

interface EvaluatorStackProps {
  evaluators: ReadonlyArray<{ user: { id: string; firstName: string; lastName: string; avatar?: string | null } }>;
  max?: number;
  size?: 'xs' | 'sm';
}

/**
 * Overlapping evaluator avatars that still name everyone: each avatar carries the full name as a tooltip and
 * as screen-reader text, and the overflow chip says "y n más" (accessibility.md › Vision).
 */
export function EvaluatorStack({ evaluators, max = 3, size = 'sm' }: EvaluatorStackProps) {
  const { t } = useI18n();
  if (evaluators.length === 0) return null;
  const shown = evaluators.slice(0, max);
  const extra = evaluators.length - shown.length;
  const extraSize = size === 'xs' ? 'size-6' : 'size-8';
  return (
    <ul aria-label={t.interviews.colEvaluators} className="flex -space-x-2">
      {shown.map((ev) => {
        const name = `${ev.user.firstName} ${ev.user.lastName}`;
        return (
          <li key={ev.user.id} title={name} className="rounded-full ring-2 ring-white">
            <CandidateAvatar
              firstName={ev.user.firstName}
              lastName={ev.user.lastName}
              avatar={ev.user.avatar}
              size={size}
              decorative
            />
            <span className="sr-only">{name}</span>
          </li>
        );
      })}
      {extra > 0 && (
        <li
          className={`${extraSize} flex items-center justify-center rounded-full bg-surface text-caption font-semibold text-secondary ring-2 ring-white`}
        >
          <span aria-hidden="true">+{extra}</span>
          <span className="sr-only">{t.interviews.evaluatorsMore.replace('{n}', String(extra))}</span>
        </li>
      )}
    </ul>
  );
}
