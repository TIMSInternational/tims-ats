import { roleLabel, roleLabelsFor } from '../../lib/role-labels';
import type { Invitation } from './invitation-setup-api';

export function InvitationSummary({
  invitation,
  locale,
  noRole,
  expires,
}: {
  invitation: Invitation;
  locale: 'es' | 'en';
  noRole: string;
  expires: string;
}) {
  return (
    <div className="my-6 rounded-xl bg-surface p-4">
      <p className="text-subheading font-semibold text-primary">{invitation.organizationName}</p>
      <p className="mt-1 break-all text-body text-secondary">{invitation.email}</p>
      <p className="mt-2 text-callout text-secondary">
        {invitation.roleSlug ? roleLabel(roleLabelsFor(locale), invitation.roleSlug) : noRole}
      </p>
      <p className="mt-3 text-callout text-muted">
        {expires}: {new Date(invitation.expiresAt).toLocaleDateString(locale)}
      </p>
    </div>
  );
}
