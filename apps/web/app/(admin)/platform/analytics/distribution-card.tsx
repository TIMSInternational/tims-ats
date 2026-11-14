'use client';

import { ProgressBar } from '../../../../components';

export interface DistributionRow {
  key: string;
  label: string;
  /** 0–100, drives the bar. */
  pct: number;
  /** The text read out and shown at the end of the row, e.g. "25 % · 3". */
  valueText: string;
}

interface DistributionCardProps {
  id: string;
  title: string;
  rows: DistributionRow[];
  emptyText: string;
  footer?: React.ReactNode;
}

/**
 * A titled list of labelled bars. The value is text beside the bar, never inside it, so it stays legible
 * at any width (accessibility.md › Vision).
 */
export function DistributionCard({ id, title, rows, emptyText, footer }: DistributionCardProps) {
  return (
    <section aria-labelledby={id} className="rounded-xl bg-white p-5 shadow-card">
      <h2 id={id} className="mb-4 text-heading font-semibold text-brand">
        {title}
      </h2>
      {rows.length > 0 ? (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.key}>
              <ProgressBar kind="meter" label={row.label} value={row.pct} valueText={row.valueText} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-6 text-center text-body text-secondary">{emptyText}</p>
      )}
      {footer && <div className="mt-3 border-t border-border pt-3 text-callout text-secondary">{footer}</div>}
    </section>
  );
}
