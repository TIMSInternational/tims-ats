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
    <div className="my-7 rounded-2xl bg-[#f6f5fa] p-5">
      <p className="font-semibold">{invitation.organizationName}</p>
      <p className="mt-1 break-all text-sm text-slate-600">{invitation.email}</p>
      <p className="mt-2 text-xs text-slate-600">{invitation.roleSlug?.replaceAll('_', ' ') || noRole}</p>
      <p className="mt-3 text-xs text-slate-500">
        {expires}: {new Date(invitation.expiresAt).toLocaleDateString(locale)}
      </p>
    </div>
  );
}
