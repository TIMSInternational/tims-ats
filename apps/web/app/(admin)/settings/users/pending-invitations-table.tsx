'use client';

import { useState } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { formatDate } from '../../../../lib/format-utils';
import {
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  Menu,
  Select,
  StatusBadge,
  type MenuEntry,
} from '../../../../components';
import { formatMessage } from '../../../../lib/i18n/format';
import {
  TENANT_INVITATION_STATUS_FILTERS,
  useResendTenantInvitation,
  useRevokeTenantInvitation,
  useTenantInvitationRoles,
  useTenantInvitations,
  type TenantInvitation,
  type TenantInvitationStatusFilter,
} from '../../../../lib/platform-api/tenant-invitations';
import { roleLabel } from '../../../../lib/role-labels';
import { invitationErrorMessage } from './invitation-error-message';
import { RevokeInvitationModal } from './revoke-invitation-modal';

/** "Invitaciones": heading + status filter on one row, then the list (settings-17, settings-18). */
export function PendingInvitationsTable({ headingClassName }: { headingClassName: string }) {
  const { t } = useI18n();
  const m = t.teamSettings;
  // Pending (not yet expired) invitations first; expired ones are one filter away instead of silently
  // crowding live ones out of a fixed-size list.
  const [filter, setFilter] = useState<TenantInvitationStatusFilter>('active');
  const invitations = useTenantInvitations(true, filter);
  const roles = useTenantInvitationRoles(true);
  const [revoking, setRevoking] = useState<TenantInvitation | null>(null);

  const resend = useResendTenantInvitation({
    onSuccess: () => toast(m.resent, { type: 'success' }),
    onError: (error) => toast(invitationErrorMessage(error, 'resend', m), { type: 'error' }),
  });
  const revoke = useRevokeTenantInvitation({
    onSuccess: () => {
      setRevoking(null);
      toast(m.revoked, { type: 'success' });
    },
    onError: (error) => {
      setRevoking(null);
      toast(invitationErrorMessage(error, 'revoke', m), { type: 'error' });
    },
  });

  const grantableRoles = new Set((roles.data ?? []).map((role) => role.slug));
  const statusMap = {
    pending: { tone: 'warning' as const, label: m.statusPending },
    sent: { tone: 'info' as const, label: m.statusSent },
    expired: { tone: 'neutral' as const, label: m.statusExpired },
  };
  const busy = resend.isPending || revoke.isPending;
  const rows = invitations.data?.pages.flatMap((page) => page.invitations) ?? [];
  const filterLabels: Record<TenantInvitationStatusFilter, string> = {
    active: m.filterActive,
    expired: m.filterExpired,
    all: m.filterAll,
  };
  // Resend revives a grant of the invitation's role, so the API refuses it (403) unless the caller could
  // grant that role. `roles.data` IS the caller's grantable list; mirror the rule so the button is not a trap.
  // A NULL role is accepted as `employee`. Until the list loads, defer to the server.
  const canResend = (inv: TenantInvitation) => !roles.data || grantableRoles.has(inv.roleSlug ?? 'employee');

  const roleText = (inv: TenantInvitation) => (inv.roleSlug ? roleLabel(t.roles, inv.roleSlug) : m.noRole);
  // A resend the caller may not make stays visible but disabled, with its reason on screen and announced
  // (not only in a hover tooltip, which keyboard and touch users never see).
  const resendReasonId = (inv: TenantInvitation) => `invite-resend-reason-${inv.id}`;
  const notGrantableNote = (inv: TenantInvitation, withId: boolean) => (
    <span
      id={withId ? resendReasonId(inv) : undefined}
      className="inline-flex items-center gap-1 text-caption text-secondary"
    >
      <svg
        className="size-3.5 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8h.01M11 12h1v4h1" />
      </svg>
      {m.resendNotGrantable}
    </span>
  );
  const menuFor = (inv: TenantInvitation): MenuEntry[] => [
    { key: 'resend', label: m.resend, disabled: busy || !canResend(inv), onSelect: () => resend.mutate(inv.id) },
    { key: 'revoke', label: m.revoke, destructive: true, disabled: busy, onSelect: () => setRevoking(inv) },
  ];

  const mobileList = (
    <ul className="divide-y divide-border">
      {rows.map((inv) => (
        <li key={inv.id} className="flex items-start justify-between gap-3 px-4 py-3">
          <div className="min-w-0 space-y-0.5">
            <p className="truncate text-body font-medium text-primary">{inv.email}</p>
            <p className="text-callout text-secondary">
              {roleText(inv)} · {formatMessage(m.expiresOn, { date: formatDate(inv.expiresAt) })}
            </p>
            <StatusBadge status={inv.status} map={statusMap} />
            {!canResend(inv) && <p>{notGrantableNote(inv, false)}</p>}
          </div>
          <Menu items={menuFor(inv)} label={formatMessage(m.rowActions, { name: inv.email })} />
        </li>
      ))}
    </ul>
  );

  return (
    <section aria-labelledby="team-pending-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="team-pending-heading" className={headingClassName}>
          {m.pendingTitle}
        </h2>
        <label className="flex items-center gap-2 text-callout text-secondary">
          {m.filterLabel}
          <Select
            value={filter}
            onChange={(event) => setFilter(event.target.value as TenantInvitationStatusFilter)}
            className="w-auto"
          >
            {TENANT_INVITATION_STATUS_FILTERS.map((value) => (
              <option key={value} value={value}>
                {filterLabels[value]}
              </option>
            ))}
          </Select>
        </label>
      </div>
      {invitations.isError ? (
        <ErrorState
          message={invitationErrorMessage(invitations.error, 'read', m)}
          onRetry={() => void invitations.refetch()}
          error={invitations.error}
        />
      ) : (
        <DataTable
          loading={invitations.isLoading}
          label={m.pendingTitle}
          mobileList={rows.length > 0 ? mobileList : undefined}
          columns={[
            { key: 'email', label: m.colEmail },
            { key: 'role', label: m.colRole },
            { key: 'status', label: m.colStatus },
            { key: 'expires', label: m.colExpires },
            { key: 'actions', label: m.colActions, align: 'right' },
          ]}
          empty={<EmptyState message={m.pendingEmpty} />}
        >
          {rows.map((inv) => (
            <tr key={inv.id} className="border-b border-border last:border-0">
              <td className="px-4 py-3 text-body text-primary">{inv.email}</td>
              <td className="px-4 py-3 text-body text-secondary">{roleText(inv)}</td>
              <td className="px-4 py-3">
                <StatusBadge status={inv.status} map={statusMap} />
              </td>
              <td className="px-4 py-3 text-body tabular-nums text-secondary">{formatDate(inv.expiresAt)}</td>
              <td className="px-4 py-3 text-right">
                <div className="flex flex-col items-end gap-1">
                  <div className="flex justify-end gap-2 whitespace-nowrap">
                    <Button
                      variant="tertiary"
                      size="sm"
                      disabled={busy || !canResend(inv)}
                      aria-describedby={canResend(inv) ? undefined : resendReasonId(inv)}
                      onClick={() => resend.mutate(inv.id)}
                    >
                      {m.resend}
                    </Button>
                    <Button variant="destructive-secondary" size="sm" disabled={busy} onClick={() => setRevoking(inv)}>
                      {m.revoke}
                    </Button>
                  </div>
                  {!canResend(inv) && notGrantableNote(inv, true)}
                </div>
              </td>
            </tr>
          ))}
        </DataTable>
      )}
      {invitations.hasNextPage && (
        <Button
          variant="secondary"
          className="self-center"
          onClick={() => void invitations.fetchNextPage()}
          disabled={invitations.isFetchingNextPage}
        >
          {m.loadMore}
        </Button>
      )}
      {revoking && (
        <RevokeInvitationModal
          email={revoking.email}
          isPending={revoke.isPending}
          onCancel={() => setRevoking(null)}
          onConfirm={() => revoke.mutate(revoking.id)}
        />
      )}
    </section>
  );
}
