'use client';

import Link from 'next/link';
import { useI18n } from '../../../../lib/i18n';
import type { BulkInvitationResponse } from '../../../../lib/platform-api/bulk-invitation-create';

export function BulkResultStep({ bulkResult, onSuccess }: { bulkResult: BulkInvitationResponse; onSuccess: () => void }) {
  const { t } = useI18n();
  const { summary, results } = bulkResult;
  const reasons = {
    duplicate_row: t.invitations.bulkDuplicateRow, already_invited: t.invitations.bulkAlreadyInvited,
    organization_unavailable: t.invitations.bulkOrganizationUnavailable, role_unavailable: t.invitations.bulkRoleUnavailable,
    delivery_unconfirmed: t.invitations.bulkDeliveryUnconfirmed, state_changed: t.invitations.bulkStateChanged,
    state_unconfirmed: t.invitations.bulkStateUnconfirmed, not_attempted: t.invitations.bulkNotAttempted,
    operation_unconfirmed: t.invitations.bulkOperationUnconfirmed,
  };
  return (
    <div className="space-y-4 py-4">
      <h3 className="text-lg font-semibold text-[#333]">{t.invitations.bulkResultsTitle}</h3>
      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="rounded-lg bg-green-50 p-3"><p className="text-2xl font-bold text-green-600">{summary.sent}</p><p className="text-xs">{t.invitations.bulkSent}</p></div>
        <div className="rounded-lg bg-amber-50 p-3"><p className="text-2xl font-bold text-amber-600">{summary.duplicates}</p><p className="text-xs">{t.invitations.bulkDuplicates}</p></div>
        <div className="rounded-lg bg-red-50 p-3"><p className="text-2xl font-bold text-red-600">{summary.errors}</p><p className="text-xs">{t.invitations.bulkNeedsAttention}</p></div>
      </div>
      <p className="text-sm text-[#585858]">{t.invitations.bulkRecoveryHelp}</p>
      <div className="max-h-72 overflow-auto rounded-lg border border-[#EDEDED]">
        <table className="w-full text-left text-xs">
          <thead><tr><th className="p-2">{t.invitations.userEmail}</th><th className="p-2">{t.invitations.bulkOutcome}</th></tr></thead>
          <tbody>{results.map(row => <tr key={row.index} className="border-t border-[#EDEDED]">
            <td className="p-2 break-all">{row.email}</td><td className="p-2">{row.reason ? reasons[row.reason] : t.invitations.bulkSent}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="flex justify-end gap-3">
        <Link href="/platform/invitations" className="rounded-lg border border-[#EDEDED] px-4 py-2 text-sm">{t.invitations.bulkReviewInvitations}</Link>
        <button onClick={onSuccess} className="rounded-lg bg-[#1F114C] px-4 py-2 text-sm text-white">{t.common.close}</button>
      </div>
    </div>
  );
}
