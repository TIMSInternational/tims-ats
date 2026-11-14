'use client';

import React from 'react';
import { Button } from './button';
import type { ButtonVariant } from './button-styles';

export interface EmptyStateAction {
  label: string;
  /** An action… */
  onClick?: () => void;
  /** …or a link (rendered as a Next.js Link). */
  href?: string;
  /** Defaults to primary for `action` and secondary for `secondaryAction`. Use secondary when the page already has a primary. */
  variant?: ButtonVariant;
}

interface EmptyStateProps {
  /** Decorative icon. Defaults to a neutral tray; pass an outline svg at size-8 (size-5 when compact). */
  icon?: React.ReactNode;
  /** The title: what is empty ("Aún no hay vacantes"). `message` is the legacy name of the same prop. */
  title?: React.ReactNode;
  message?: React.ReactNode;
  /** One line: why, and what the action does. */
  description?: React.ReactNode;
  /** "Nothing yet" invites the first action; "no results" offers "Borrar filtros" (t.common.clearFilters). */
  action?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
  /** compact = one centred row for cards and dashboard panels. */
  size?: 'default' | 'compact';
  className?: string;
}

function DefaultIcon({ className }: { className: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path d="M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859M2.25 13.5V18A2.25 2.25 0 004.5 20.25h15A2.25 2.25 0 0021.75 18v-4.5M2.25 13.5l2.394-7.183A2.25 2.25 0 016.78 4.75h10.44a2.25 2.25 0 012.136 1.567L21.75 13.5" />
    </svg>
  );
}

function ActionButton({
  action,
  fallback,
  size,
}: {
  action: EmptyStateAction;
  fallback: ButtonVariant;
  size: 'sm' | 'md';
}) {
  const variant = action.variant ?? fallback;
  if (action.href) {
    return (
      <Button href={action.href} variant={variant} size={size}>
        {action.label}
      </Button>
    );
  }
  return (
    <Button onClick={action.onClick} variant={variant} size={size}>
      {action.label}
    </Button>
  );
}

/** Empty state (foundation-spec.md §13, writing.md "Provide clear next steps on any blank screens"). */
export function EmptyState({
  icon,
  title,
  message,
  description,
  action,
  secondaryAction,
  size = 'default',
  className = '',
}: EmptyStateProps) {
  const heading = title ?? message;
  const compact = size === 'compact';
  return (
    <div
      className={`flex flex-col items-center text-center ${compact ? 'px-4 py-4' : 'px-5 py-12 md:py-16'} ${className}`}
    >
      <div className={`flex justify-center text-muted ${compact ? 'mb-2' : 'mb-3'}`} aria-hidden="true">
        {icon ?? <DefaultIcon className={compact ? 'size-5' : 'size-8'} />}
      </div>
      {heading && (
        <p className={compact ? 'text-body font-medium text-primary' : 'text-subheading font-semibold text-primary'}>
          {heading}
        </p>
      )}
      {description && <p className="mt-1 max-w-sm text-callout text-secondary">{description}</p>}
      {(action || secondaryAction) && (
        <div className={`flex flex-wrap items-center justify-center gap-2 ${compact ? 'mt-3' : 'mt-4'}`}>
          {secondaryAction && (
            <ActionButton action={secondaryAction} fallback="secondary" size={compact ? 'sm' : 'md'} />
          )}
          {action && <ActionButton action={action} fallback="primary" size={compact ? 'sm' : 'md'} />}
        </div>
      )}
    </div>
  );
}
