'use client';

import { Lock } from 'lucide-react';
import { useI18n } from '../../../../../lib/i18n';
import { isForbiddenError } from '../../../../../lib/forbidden-error';
import { EvalButton } from './eval-button';
import { EvalCallout } from './eval-callout';
import { EVAL_ACTIONS_START_CLASSES, EVAL_CALLOUT_TITLE_CLASSES } from './eval-control-styles';

/**
 * A section that could not load, in the PCA look: an err Callout (role="alert") with what failed, the connection hint,
 * and "Retry" as a compact secondary button. Same contract as the shared ErrorState (size compact / inline): a
 * permission denial reads t.common.errorForbidden with a lock and offers no retry (a denial never succeeds on retry).
 */
export function EvalLoadError({
  title,
  description,
  onRetry,
  error,
  className = '',
}: {
  /** What failed ("No se pudieron cargar sus postulaciones"). */
  title: string;
  /** The line under it; defaults to the connection hint when a retry is offered. */
  description?: string;
  onRetry?: () => void;
  /** The failed query's error, to recognise a permission denial. */
  error?: unknown;
  className?: string;
}) {
  const { t } = useI18n();
  const forbidden = isForbiddenError(error);
  const canRetry = Boolean(onRetry) && !forbidden;
  const detail = forbidden ? undefined : (description ?? (canRetry ? t.common.loadErrorHint : undefined));
  return (
    <EvalCallout
      tone={forbidden ? 'neutral' : 'err'}
      icon={forbidden ? <Lock aria-hidden="true" /> : undefined}
      role="alert"
      className={className}
    >
      <p className={EVAL_CALLOUT_TITLE_CLASSES}>{forbidden ? t.common.errorForbidden : title}</p>
      {detail && <p className="m-0 mt-0.5">{detail}</p>}
      {canRetry && (
        <div className={`${EVAL_ACTIONS_START_CLASSES} mt-2.5`}>
          <EvalButton variant="secondary" size="compact" onClick={onRetry}>
            {t.common.retry}
          </EvalButton>
        </div>
      )}
    </EvalCallout>
  );
}
