'use client';

import React from 'react';
import { useI18n } from '../lib/i18n';
import { isForbiddenError } from '../lib/forbidden-error';

interface ErrorStateProps {
  /** Called when the user clicks retry — typically the query's `refetch`. */
  onRetry?: () => void;
  /** Optional override; defaults to the generic "unexpected error" message. */
  message?: string;
  /**
   * The failed query's error (`query.error`). When it is a permission denial (tRPC FORBIDDEN or a
   * C# 403) the state reads "no access" and offers no retry — a denial never succeeds on retry.
   */
  error?: unknown;
}

// Shared inline error state for data-driven surfaces. Rendered when a query fails
// (`query.isError`) so the page communicates the failure and offers a retry,
// instead of rendering a blank/empty shell. Complements the route-level error
// boundaries, which only catch THROWN errors — a failed query resolves to an
// error state, it does not throw.
export function ErrorState({ onRetry, message, error }: ErrorStateProps) {
  const { t } = useI18n();
  const forbidden = isForbiddenError(error);
  return (
    <div className="px-5 py-16 text-center">
      <div className="flex justify-center mb-3">
        {forbidden ? (
          <svg
            className="w-8 h-8 text-[#1F114C]/70"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            viewBox="0 0 24 24"
            aria-hidden
          >
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 018 0v4" />
          </svg>
        ) : (
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
        )}
      </div>
      <p className="text-sm text-[#8B8B8B]">{forbidden ? t.common.errorForbidden : (message ?? t.common.error)}</p>
      {onRetry && !forbidden && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 h-9 px-4 rounded-lg bg-[#1F114C] text-white text-sm font-medium hover:bg-[#2a1866] transition"
        >
          {t.common.retry}
        </button>
      )}
    </div>
  );
}
