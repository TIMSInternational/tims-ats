'use client';

import type { ReactNode } from 'react';
import { ErrorState } from '../../../../components';
import { Skeleton } from '../../../../components/skeleton';
import { useI18n } from '../../../../lib/i18n';

interface AnalyticsCardProps {
  title: string;
  /** Flex share on md+ (e.g. 'md:flex-[40]'); full width below md. */
  flex?: string;
  /** Trailing element beside the title (a count chip). */
  aside?: ReactNode;
  loading?: boolean;
  /** A failed read: the card keeps its title and shows a compact ErrorState (403 reads as "no access"). */
  error?: unknown;
  onRetry?: () => void;
  children?: ReactNode;
}

/** One analytics card: an h2, then a skeleton, an error with retry, or the content (feedback.md). */
export function AnalyticsCard({ title, flex = 'md:flex-1', aside, loading, error, onRetry, children }: AnalyticsCardProps) {
  const { t } = useI18n();
  return (
    <section className={`w-full min-w-0 ${flex} rounded-xl border border-border bg-white p-4 shadow-card md:p-5`} aria-busy={loading || undefined}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-heading font-semibold text-brand">{title}</h2>
        {!loading && !error && aside}
      </div>
      {loading ? (
        <>
          <span className="sr-only">{t.common.loadingContent}</span>
          <Skeleton className="h-40 w-full rounded" />
        </>
      ) : error ? (
        <ErrorState error={error} onRetry={onRetry} size="compact" />
      ) : (
        children
      )}
    </section>
  );
}
