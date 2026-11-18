'use client';

import React from 'react';
import { useI18n } from '../lib/i18n';
import { isForbiddenError } from '../lib/forbidden-error';
import { Button } from './button';

interface ErrorStateProps {
  /** Called when the user clicks retry — typically the query's `refetch`. */
  onRetry?: () => void;
  /**
   * The headline. Name what failed: "No se pudieron cargar las vacantes". Defaults to
   * t.common.loadErrorTitle ("No se pudo cargar la información"). `title` is the same prop.
   */
  message?: string;
  title?: string;
  /** The line under it. Defaults to the connection hint when a retry is offered. */
  description?: string;
  /**
   * The failed query's error (`query.error`). When it is a permission denial (tRPC FORBIDDEN or a
   * C# 403) the state reads "no access" and offers no retry — a denial never succeeds on retry.
   */
  error?: unknown;
  /** notFound = the record does not exist: no retry, a back link instead. */
  variant?: 'error' | 'notFound';
  /** The way out for the notFound variant ("‹ Volver a vacantes"). */
  back?: { href: string; label: string };
  /**
   * default = centred block in place of a page or table; compact = inside a card (keeps the card's own
   * heading); inline = one line for selects, headers and table rows.
   */
  size?: 'default' | 'compact' | 'inline';
  className?: string;
}

// The path data of the state's one <svg> (a lookup, not extra icon components: one component per file).
const ICON_PATHS = {
  alert: ['M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z'],
  lock: ['M7 11h10a2 2 0 012 2v6a2 2 0 01-2 2H7a2 2 0 01-2-2v-6a2 2 0 012-2z', 'M8 11V7a4 4 0 018 0v4'],
  search: ['M18 11a7 7 0 11-14 0 7 7 0 0114 0z', 'm20 20-3.5-3.5'],
} as const;

// Shared error state for data-driven surfaces (foundation-spec.md §13). Rendered when a query fails
// (`query.isError`) so the page says what failed and offers a retry, instead of a blank shell. Complements
// the route-level error boundaries, which only catch THROWN errors — a failed query does not throw.
export function ErrorState({
  onRetry,
  message,
  title,
  description,
  error,
  variant = 'error',
  back,
  size = 'default',
  className = '',
}: ErrorStateProps) {
  const { t } = useI18n();
  const forbidden = isForbiddenError(error);
  const notFound = !forbidden && variant === 'notFound';
  const canRetry = Boolean(onRetry) && !forbidden && !notFound;

  const heading = forbidden
    ? t.common.errorForbidden
    : notFound
      ? (title ?? message ?? t.common.notFoundTitle)
      : (title ?? message ?? t.common.loadErrorTitle);
  const detail = forbidden
    ? undefined
    : notFound
      ? (description ?? t.common.notFoundHint)
      : (description ?? (canRetry ? t.common.loadErrorHint : undefined));
  const iconTone = forbidden || notFound ? 'text-brand' : 'text-danger';
  const paths = ICON_PATHS[forbidden ? 'lock' : notFound ? 'search' : 'alert'];
  const icon = (className: string) => (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );

  const retry = canRetry && (
    <Button
      variant={size === 'inline' ? 'tertiary' : 'secondary'}
      size={size === 'default' ? 'md' : 'sm'}
      onClick={onRetry}
    >
      {t.common.retry}
    </Button>
  );
  const backLink = notFound && back && (
    <Button href={back.href} variant="secondary" size={size === 'default' ? 'md' : 'sm'}>
      {back.label}
    </Button>
  );

  if (size === 'inline') {
    return (
      <div role="alert" className={`flex flex-wrap items-center gap-2 text-callout text-danger ${className}`}>
        {icon('size-4 shrink-0')}
        <span>{heading}</span>
        {retry}
        {backLink}
      </div>
    );
  }

  const compact = size === 'compact';
  return (
    <div
      role="alert"
      className={`flex flex-col items-center text-center ${compact ? 'px-4 py-6' : 'px-5 py-12 md:py-16'} ${className}`}
    >
      {icon(`${compact ? 'mb-2 size-6' : 'mb-3 size-8'} ${iconTone}`)}
      <p className={compact ? 'text-body font-medium text-primary' : 'text-subheading font-semibold text-primary'}>
        {heading}
      </p>
      {detail && <p className="mt-1 max-w-sm text-callout text-secondary">{detail}</p>}
      {(retry || backLink) && <div className={compact ? 'mt-3' : 'mt-4'}>{retry || backLink}</div>}
    </div>
  );
}
