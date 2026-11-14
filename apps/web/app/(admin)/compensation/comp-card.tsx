'use client';

import React, { useId } from 'react';

interface CompCardProps {
  title: string;
  /** Right-aligned note beside the title ("Mensual por moneda") or a count. */
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/** A compensation dashboard card: an h2 that names the region, then the content. */
export function CompCard({ title, aside, children, className = '' }: CompCardProps) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className={`rounded-xl border border-border bg-white p-4 shadow-card md:p-5 ${className}`}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="text-subheading font-semibold text-primary">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
