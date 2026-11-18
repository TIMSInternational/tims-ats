'use client';

import { Skeleton } from '../../../../components';
import { useI18n } from '../../../../lib/i18n';

/** Busy placeholder in the shape of a DEI card's rows. */
export function DeiCardSkeleton({ rows = 3 }: { rows?: number }) {
  const { t } = useI18n();
  return (
    <div aria-busy="true" className="space-y-2">
      <span className="sr-only">{t.common.loadingContent}</span>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-5 w-full" />
      ))}
    </div>
  );
}
