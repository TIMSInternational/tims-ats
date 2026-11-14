'use client';

import { useI18n } from '../../../../../lib/i18n/index';

interface ApprovalDotsProps {
  approvals: ReadonlyArray<{ status: string }>;
}

/**
 * One mark per approval step: a check for approved, an x for rejected, an empty ring for pending, plus a
 * screen-reader summary ("1 aprobada, 0 rechazadas de 2") so no outcome is colour only (accessibility.md › Vision).
 */
export function ApprovalDots({ approvals }: ApprovalDotsProps) {
  const { t } = useI18n();
  const total = approvals.length;
  if (total === 0) return <span className="text-caption text-muted">—</span>;
  const approved = approvals.filter((a) => a.status === 'approved').length;
  const rejected = approvals.filter((a) => a.status === 'rejected').length;
  const summary = t.offers.approvalsSummary
    .replace('{approved}', String(approved))
    .replace('{rejected}', String(rejected))
    .replace('{total}', String(total));
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex -space-x-1" aria-hidden="true">
        {approvals.map((a, i) => (
          <span
            key={i}
            className={`flex size-5 items-center justify-center rounded-full border-2 border-white ${
              a.status === 'approved' ? 'bg-success' : a.status === 'rejected' ? 'bg-danger' : 'bg-surface ring-1 ring-field-border'
            }`}
          >
            {a.status === 'approved' && (
              <svg className="size-3 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path d="m4.5 12.75 6 6 9-13.5" />
              </svg>
            )}
            {a.status === 'rejected' && (
              <svg className="size-3 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            )}
          </span>
        ))}
      </div>
      <span className="text-caption text-secondary tabular-nums" aria-hidden="true">
        {approved}/{total}
      </span>
      <span className="sr-only">{summary}</span>
    </div>
  );
}
