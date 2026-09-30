'use client';

import { useI18n } from '../lib/i18n';
import type { AssignablePeopleFailure } from '../lib/platform-api/assignable-people';

interface AssignablePeopleErrorProps {
  failure: AssignablePeopleFailure;
  onRetry: () => void;
}

/** Inline, translated error for a people picker — replaces an endless loading label or a raw 403 text. */
export function AssignablePeopleError({ failure, onRetry }: AssignablePeopleErrorProps) {
  const { t } = useI18n();
  const message = failure === 'forbidden' ? t.assignablePeople.forbidden : t.assignablePeople.loadError;
  return (
    <div role="alert" className="flex items-center justify-between gap-3 px-3 py-3 text-[12px] text-[#DD0C15]">
      <span>{message}</span>
      {failure === 'unavailable' && (
        <button type="button" onClick={onRetry} className="shrink-0 font-medium text-[#1F114C] underline">
          {t.common.retry}
        </button>
      )}
    </div>
  );
}
