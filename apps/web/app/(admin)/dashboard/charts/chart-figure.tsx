'use client';

import React, { useId } from 'react';

interface ChartFigureProps {
  /** One sentence that says what the chart shows ("El MRR subió de $3,1K a $12,5K en 12 meses"). */
  summary: string;
  /** Column headers of the text alternative, e.g. [Mes, MRR]. */
  columns: [string, string];
  /** The plotted values, one row per mark. */
  rows: { label: string; value: string }[];
  /** The Recharts chart. Hidden from assistive tech: the summary and table carry it. */
  children: React.ReactNode;
  className?: string;
}

/**
 * A chart with a text alternative (charts.md › Enhancing the accessibility of a chart: "provide an overview
 * of the chart's structure and purpose"). Screen readers get the summary and a table of the plotted
 * values; the SVG itself is aria-hidden, because Recharts marks are unnamed shapes.
 */
export function ChartFigure({ summary, columns, rows, children, className = '' }: ChartFigureProps) {
  const summaryId = useId();
  return (
    <figure aria-describedby={summaryId} className={`m-0 ${className}`}>
      <div aria-hidden="true">{children}</div>
      <figcaption id={summaryId} className="sr-only">
        {summary}
      </figcaption>
      {rows.length > 0 && (
        <table className="sr-only">
          <thead>
            <tr>
              <th scope="col">{columns[0]}</th>
              <th scope="col">{columns[1]}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={`${row.label}-${i}`}>
                <th scope="row">{row.label}</th>
                <td>{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </figure>
  );
}
