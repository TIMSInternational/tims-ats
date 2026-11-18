'use client';

import React from 'react';
import Link from 'next/link';

interface PageHeaderProps {
  /** The page's one h1: names the content, never the product (toolbars.md › Titles). */
  title: React.ReactNode;
  /** One line under the title when the page's purpose is not obvious. */
  description?: React.ReactNode;
  /** Detail pages: a back link to the parent list ("‹ Vacantes"). List pages have none. */
  back?: { href: string; label: string };
  /** Inline meta beside the title, such as a StatusBadge. */
  meta?: React.ReactNode;
  /** Secondary actions first, then ONE primary Button last (trailing). More than 3 → a Menu. */
  actions?: React.ReactNode;
  /** Optional content under the title row, such as Tabs. */
  children?: React.ReactNode;
  /** Id for the h1, e.g. to label a region with aria-labelledby. */
  titleId?: string;
  className?: string;
}

/** The page header pattern (foundation-spec.md §10): back link, h1, meta, description, trailing actions. */
export function PageHeader({
  title,
  description,
  back,
  meta,
  actions,
  children,
  titleId,
  className = '',
}: PageHeaderProps) {
  return (
    <header className={`shrink-0 border-b border-border bg-white px-4 md:px-6 ${className}`}>
      <div className="flex min-h-16 flex-wrap items-center justify-between gap-x-4 gap-y-3 py-3">
        <div className="min-w-0">
          {back && (
            <Link
              href={back.href}
              className="mb-0.5 inline-flex items-center gap-1 text-callout text-secondary transition-colors hover:text-brand pointer-coarse:min-h-11"
            >
              <svg
                className="size-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="M15 19l-7-7 7-7" />
              </svg>
              {back.label}
            </Link>
          )}
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <h1 id={titleId} className="min-w-0 truncate font-display text-title font-semibold text-brand">
              {title}
            </h1>
            {meta}
          </div>
          {description && <p className="mt-0.5 max-w-prose text-callout text-secondary">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  );
}
