'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { Button } from '../../../../components';
import type { Eval360Cycle } from '../../../../lib/trpc-types';
import {
  useEvaluation360OpenCycle,
  useEvaluation360CloseCycle,
  useEvaluation360PublishCycle,
} from '../../../../lib/platform-api/evaluation360';

interface CycleActionsProps {
  cycle: Eval360Cycle;
  onManage: (cycleId: string) => void;
  className?: string;
}

/** The single legal next-state transition (draft->open->closed->published) plus "Gestionar evaluadores…". */
export function CycleActions({ cycle, onManage, className = '' }: CycleActionsProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['platform-api', 'evaluation360', 'cycles'] });
  };

  const openCycle = useEvaluation360OpenCycle({
    onSuccess: () => {
      toast(t.evaluation360.cycleOpened, { type: 'success' });
      invalidate();
    },
    onError: (err) => toast(err.message, { type: 'error' }),
  });
  const closeCycle = useEvaluation360CloseCycle({
    onSuccess: () => {
      toast(t.evaluation360.cycleClosed, { type: 'success' });
      invalidate();
    },
    onError: (err) => toast(err.message, { type: 'error' }),
  });
  const publishCycle = useEvaluation360PublishCycle({
    onSuccess: () => {
      toast(t.evaluation360.cyclePublished, { type: 'success' });
      invalidate();
    },
    onError: (err) => toast(err.message, { type: 'error' }),
  });

  const isPending = openCycle.isPending || closeCycle.isPending || publishCycle.isPending;

  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {cycle.status === 'draft' && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => openCycle.mutate({ cycleId: cycle.id })}
          disabled={isPending}
          loading={openCycle.isPending}
        >
          {t.evaluation360.openButton}
        </Button>
      )}
      {cycle.status === 'open' && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => closeCycle.mutate({ cycleId: cycle.id })}
          disabled={isPending}
          loading={closeCycle.isPending}
        >
          {t.evaluation360.closeButton}
        </Button>
      )}
      {cycle.status === 'closed' && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => publishCycle.mutate({ cycleId: cycle.id })}
          disabled={isPending}
          loading={publishCycle.isPending}
        >
          {t.evaluation360.publishButton}
        </Button>
      )}
      <Button variant="secondary" size="sm" onClick={() => onManage(cycle.id)}>
        {t.evaluation360.manageButton}
      </Button>
    </div>
  );
}
