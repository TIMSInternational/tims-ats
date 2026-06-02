'use client';

import { useI18n } from '../../../../../lib/i18n';
import { formatDate } from '../../../../../lib/format-utils';

interface Approval {
  id: string;
  step: number;
  status: string;
  comment: string | null;
  decidedAt: Date | string | null;
  approver: {
    id: string;
    firstName: string;
    lastName: string;
    avatar: string | null;
  };
}

interface ApprovalChainProps {
  approvals: Approval[];
}

const STATUS_ICONS: Record<string, { bg: string; icon: 'check' | 'x' | 'clock' }> = {
  approved: { bg: 'bg-green-500', icon: 'check' },
  rejected: { bg: 'bg-[#DD0C15]', icon: 'x' },
  pending: { bg: 'bg-amber-400', icon: 'clock' },
  cancelled: { bg: 'bg-gray-300', icon: 'x' },
};

export function ApprovalChain({ approvals }: ApprovalChainProps) {
  const { t } = useI18n();

  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h3 className="text-[14px] font-semibold text-[#1F114C] mb-3">{t.vacancies.approvalChain}</h3>
      <div className="space-y-0">
        {approvals.map((a, i) => {
          const config = STATUS_ICONS[a.status] ?? STATUS_ICONS.pending;
          return (
            <div key={a.id}>
              {i > 0 && <div className="ml-3 w-0.5 h-4 bg-[#EDEDED]" />}
              <div className="flex items-center gap-3 py-2">
                <div className={`w-6 h-6 rounded-full ${config.bg} flex items-center justify-center shrink-0`}>
                  {config.icon === 'check' && (
                    <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="m4.5 12.75 6 6 9-13.5" /></svg>
                  )}
                  {config.icon === 'x' && (
                    <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" /></svg>
                  )}
                  {config.icon === 'clock' && (
                    <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
                  )}
                </div>
                <div className="flex-1">
                  <p className="text-[12px] text-[#333]">
                    {a.approver.firstName} {a.approver.lastName}
                  </p>
                  <p className={`text-[10px] ${
                    a.status === 'approved' ? 'text-green-600' :
                    a.status === 'rejected' ? 'text-[#DD0C15]' :
                    a.status === 'pending' ? 'text-amber-600' :
                    'text-[#8B8B8B]'
                  }`}>
                    {a.status === 'approved' && `${t.vacancies.approved} — ${a.decidedAt ? formatDate(a.decidedAt) : ''}`}
                    {a.status === 'rejected' && `${t.vacancies.rejected} — ${a.decidedAt ? formatDate(a.decidedAt) : ''}`}
                    {a.status === 'pending' && t.vacancies.pending}
                    {a.status === 'cancelled' && t.vacancies.cancelled}
                  </p>
                  {a.comment && <p className="text-[10px] text-[#8B8B8B] mt-0.5 italic">{a.comment}</p>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
