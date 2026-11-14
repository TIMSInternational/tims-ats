'use client';

import Link from 'next/link';
import { useI18n } from '../../../../lib/i18n';
import { BUTTON_GROUP_CLASSES, Button, buttonClasses } from '../../../../components';
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
    <div className="space-y-4 py-2">
      <h3 className="text-heading font-semibold text-primary">{t.invitations.bulkResultsTitle}</h3>
      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="rounded-lg bg-success-bg p-3"><p className="text-2xl font-semibold tabular-nums text-success">{summary.sent}</p><p className="text-callout text-primary">{t.invitations.bulkSent}</p></div>
        <div className="rounded-lg bg-warning-bg p-3"><p className="text-2xl font-semibold tabular-nums text-warning">{summary.duplicates}</p><p className="text-callout text-primary">{t.invitations.bulkDuplicates}</p></div>
        <div className="rounded-lg bg-danger-bg p-3"><p className="text-2xl font-semibold tabular-nums text-danger">{summary.errors}</p><p className="text-callout text-primary">{t.invitations.bulkNeedsAttention}</p></div>
      </div>
      <p className="text-body text-secondary">{t.invitations.bulkRecoveryHelp}</p>
      <div className="max-h-72 overflow-auto rounded-lg border border-border">
        <table className="w-full text-left text-callout">
          <thead><tr><th scope="col" className="p-2 font-semibold text-secondary">{t.invitations.userEmail}</th><th scope="col" className="p-2 font-semibold text-secondary">{t.invitations.bulkOutcome}</th></tr></thead>
          <tbody>{results.map(row => <tr key={row.index} className="border-t border-border">
            <td className="break-all p-2 text-primary">{row.email}</td><td className="p-2 text-primary">{row.reason ? reasons[row.reason] : t.invitations.bulkSent}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className={BUTTON_GROUP_CLASSES}>
        <Link href="/platform/invitations" className={buttonClasses({ variant: 'secondary' })}>{t.invitations.bulkReviewInvitations}</Link>
        <Button onClick={onSuccess}>{t.common.close}</Button>
      </div>
    </div>
  );
}
