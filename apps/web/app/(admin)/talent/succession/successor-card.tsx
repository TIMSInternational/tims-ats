'use client';

import { Button, CandidateAvatar, StatusBadge } from '../../../../components';
import { useI18n, formatMessage } from '../../../../lib/i18n';
import { readinessKey, type AdjustmentTarget, type CompGapAlert, type Successor } from './succession-types';

interface SuccessorCardProps {
  successor: Successor;
  gap: CompGapAlert | undefined;
  onRequestAdjustment: (target: AdjustmentTarget) => void;
}

/** One successor in a role's pipeline: readiness, name, title and an optional comp-gap alert. */
export function SuccessorCard({ successor: s, gap, onRequestAdjustment }: SuccessorCardProps) {
  const { t } = useI18n();
  const ready = s.readiness === 'ready_now';
  return (
    <li className="rounded-lg border border-border bg-white p-3">
      <StatusBadge tone={ready ? 'success' : 'info'} className="mb-1.5">
        {t.succession[readinessKey(s.readiness)]}
      </StatusBadge>
      <div className="flex items-center gap-2">
        <CandidateAvatar
          firstName={s.user.firstName}
          lastName={s.user.lastName}
          avatar={s.user.avatar}
          size="sm"
          decorative
        />
        <div className="min-w-0">
          <p className="text-body font-medium text-primary">
            {s.user.firstName} {s.user.lastName}
          </p>
          {s.user.jobTitle && <p className="text-callout text-secondary">{s.user.jobTitle}</p>}
        </div>
      </div>
      {gap && (
        <div className="mt-2 space-y-1.5 border-t border-dashed border-border pt-2">
          <StatusBadge tone="warning">{formatMessage(t.succession.compGapLabel, { pct: gap.gapPercent })}</StatusBadge>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              onRequestAdjustment({
                userId: gap.userId,
                employeeName: `${s.user.firstName} ${s.user.lastName}`,
                previousSalary: gap.currentSalary,
                suggestedNewSalary: gap.midSalary,
              })
            }
          >
            {t.succession.requestAdjustment}
          </Button>
        </div>
      )}
    </li>
  );
}
