'use client';

import React from 'react';
import { useI18n } from '../lib/i18n';

interface ErrorStateProps {
  /** Called when the user clicks retry — typically the query's `refetch`. */
  onRetry?: () => void;
  /** Optional override; defaults to the generic "unexpected error" message. */
  message?: string;
}

// Shared inline error state for data-driven surfaces. Rendered when a query fails
// (`query.isError`) so the page communicates the failure and offers a retry,
// instead of rendering a blank/empty shell. Complements the route-level error
// boundaries, which only catch THROWN errors — a failed query resolves to an
// error state, it does not throw.
export function ErrorState({ onRetry, message }: ErrorStateProps) {
  const { t } = useI18n();
  return (
    <div className="px-5 py-16 text-center">
      <div className="flex justify-center mb-3">
        <svg
          className="w-8 h-8 text-[#DD0C15]/70"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
          />
        </svg>
      </div>
      <p className="text-sm text-[#8B8B8B]">{message ?? t.common.error}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 h-9 px-4 rounded-lg bg-[#1F114C] text-white text-sm font-medium hover:bg-[#2a1866] transition"
        >
          {t.common.retry}
        </button>
      )}
    </div>
  );
}
