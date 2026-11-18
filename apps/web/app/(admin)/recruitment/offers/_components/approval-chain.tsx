'use client';

import { useI18n } from '../../../../../lib/i18n/index';
import { StatusBadge } from '../../../../../components/status-badge';
import { formatDate } from '../../../../../lib/format-utils';

interface Approval {
  id: string;
  step: number;
  status: string;
  comment: string | null;
  decidedAt: Date | string | null;
  approver: { id: string; firstName: string; lastName: string; avatar?: string | null; jobTitle?: string | null };
}

interface ApprovalChainProps {
  approvals: Approval[];
}

export function ApprovalChain({ approvals }: ApprovalChainProps) {
  const { t } = useI18n();

  if (approvals.length === 0) return null;

  // An ordered list with the outcome in words on every step (StatusBadge), so a screen reader hears
  // "Paso 1, Laura M., Aprobado" and not just a name (accessibility.md › Vision). Stacks on phones.
  return (
    <section className="rounded-xl border border-border bg-white p-4 shadow-card md:p-5" aria-labelledby="approval-chain-title">
      <h2 id="approval-chain-title" className="mb-4 text-heading font-semibold text-brand">{t.offers.approvalChain}</h2>
      <ol className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-2">
        {approvals.map((approval, i) => {
          const isApproved = approval.status === 'approved';
          const isRejected = approval.status === 'rejected';
          // A withdrawn request cancels its pending steps (offer.withdrawApproval).
          const isCancelled = approval.status === 'cancelled';
          // B-12: the approver's job title, else "Paso n" (never the English "Step n").
          const role = approval.approver.jobTitle || t.offers.approvalStepN.replace('{n}', String(approval.step));
          // B-02: the approver's reason (required on reject) is shown, not only a red X.
          const comment = approval.comment?.trim();
          const outcome = isApproved
            ? { tone: 'success' as const, label: t.offers.approvalStepApproved }
            : isRejected
              ? { tone: 'danger' as const, label: t.offers.approvalStepRejected }
              : isCancelled
                ? { tone: 'neutral' as const, label: t.offers.approvalStepCancelled }
                : { tone: 'warning' as const, label: t.offers.approvalStepPending };

          return (
            <li key={approval.id} className="flex flex-1 items-start gap-3 sm:flex-col sm:items-center sm:gap-1 sm:text-center">
              {i > 0 && <span aria-hidden="true" className="hidden h-0.5 w-full bg-border sm:block" />}
              <span
                aria-hidden="true"
                className={`flex size-8 shrink-0 items-center justify-center rounded-full ${
                  isApproved ? 'bg-success text-white' : isRejected ? 'bg-danger text-white' : 'bg-surface text-secondary'
                }`}
              >
                {isApproved ? (
                  <svg className="size-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                ) : isRejected || isCancelled ? (
                  <svg className="size-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M6 18L18 6M6 6l12 12" />
                  </svg>
                ) : (
                  <svg className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                    <path d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
              </span>
              <div className="min-w-0 space-y-0.5 sm:flex sm:flex-col sm:items-center">
                <p className="text-callout font-medium text-primary">{role}</p>
                <p className="text-callout text-primary">
                  {approval.approver.firstName} {approval.approver.lastName.charAt(0)}.
                </p>
                <StatusBadge tone={outcome.tone}>{outcome.label}</StatusBadge>
                {approval.decidedAt && <p className="text-caption text-muted tabular-nums">{formatDate(approval.decidedAt)}</p>}
                {comment && (isApproved || isRejected) && (
                  <p className={`mt-1 max-w-[220px] whitespace-pre-line break-words text-callout ${isRejected ? 'text-danger' : 'text-secondary'}`}>
                    {(isRejected ? t.offers.approvalRejectionComment : t.offers.approvalDecisionComment).replace(
                      '{comment}',
                      comment,
                    )}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
