'use client';

import { useI18n } from '../../../../../lib/i18n/index';
import { formatDate, getInitials } from '../../../../../lib/format-utils';

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

  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h3 className="text-[14px] font-semibold text-[#1F114C] mb-4">{t.offers.approvalChain}</h3>
      <div className="flex items-center gap-2">
        {approvals.map((approval, i) => {
          const isApproved = approval.status === 'approved';
          const isRejected = approval.status === 'rejected';
          // A withdrawn request cancels its pending steps (offer.withdrawApproval).
          const isCancelled = approval.status === 'cancelled';
          // B-12: the approver's job title, else "Paso n" (never the English "Step n").
          const role = approval.approver.jobTitle || t.offers.approvalStepN.replace('{n}', String(approval.step));
          // B-02: the approver's reason (required on reject) is shown, not only a red X.
          const comment = approval.comment?.trim();

          return (
            <div key={approval.id} className="contents">
              {i > 0 && (
                <div className={`h-0.5 w-8 ${isApproved ? 'bg-green-500' : isRejected ? 'bg-red-500' : 'bg-[#EDEDED]'}`} />
              )}
              <div className="flex flex-col items-center flex-1">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center mb-1 ${
                    isApproved
                      ? 'bg-green-500'
                      : isRejected
                        ? 'bg-red-500'
                        : 'bg-[#EDEDED]'
                  }`}
                >
                  {isApproved ? (
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                  ) : isRejected || isCancelled ? (
                    <svg
                      className={`w-4 h-4 ${isCancelled ? 'text-[#8B8B8B]' : 'text-white'}`}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                    >
                      <path d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4 text-[#8B8B8B]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                      <path d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  )}
                </div>
                <p className="text-[10px] text-[#333] font-medium text-center">{role}</p>
                <p className={`text-[9px] ${isApproved ? 'text-green-600' : isRejected ? 'text-red-600' : 'text-[#8B8B8B]'}`}>
                  {approval.approver.firstName} {approval.approver.lastName.charAt(0)}.
                </p>
                {approval.decidedAt && (
                  <p className="text-[9px] text-[#8B8B8B]">{formatDate(approval.decidedAt)}</p>
                )}
                {isCancelled && <p className="text-[9px] text-[#8B8B8B]">{t.offers.approvalStepCancelled}</p>}
                {comment && (isApproved || isRejected) && (
                  <p
                    className={`mt-1 max-w-[220px] whitespace-pre-line break-words text-center text-[10px] ${isRejected ? 'text-red-700' : 'text-[#585858]'}`}
                  >
                    {(isRejected ? t.offers.approvalRejectionComment : t.offers.approvalDecisionComment).replace(
                      '{comment}',
                      comment,
                    )}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
