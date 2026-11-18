'use client';

import { ErrorState } from '../../../components';

// Proportionate "couldn't load" block for one failed dashboard section. Distinct from EmptyState (which
// means "no data"), so an errored section never renders misleading zeros. With `onRetry` (the caller's
// query refetch) the person can recover this one card without reloading the page (feedback.md).
export function LoadError({ message, onRetry, error }: { message: string; onRetry?: () => void; error?: unknown }) {
  return (
    <ErrorState size="compact" title={message} onRetry={onRetry} error={error} className="rounded-lg bg-surface" />
  );
}
