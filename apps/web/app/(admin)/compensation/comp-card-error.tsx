'use client';

import { useI18n } from '../../../lib/i18n';
import { isForbiddenError } from '../../../lib/forbidden-error';
import { ErrorState } from '../../../components';

interface CompCardErrorProps {
  /** What failed, e.g. t.compensation.bandsErr. */
  message: string;
  error: unknown;
  onRetry: () => void;
}

/**
 * A card's load failure. A permission denial reads "no access" in neutral text (retrying it can
 * never succeed); anything else is a compact error with "Reintentar".
 */
export function CompCardError({ message, error, onRetry }: CompCardErrorProps) {
  const { t } = useI18n();
  if (isForbiddenError(error)) {
    return <p className="text-callout text-secondary">{t.common.errorForbidden}</p>;
  }
  return <ErrorState size="compact" title={message} error={error} onRetry={onRetry} />;
}
