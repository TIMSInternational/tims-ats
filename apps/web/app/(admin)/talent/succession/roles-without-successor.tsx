'use client';

import type { ReactNode } from 'react';
import { Button, EmptyState, ErrorState, Skeleton, StatusBadge, type StatusTone } from '../../../../components';
import { useI18n, pluralize, formatMessage } from '../../../../lib/i18n';

interface RoleWithoutSuccessor {
  id: string;
  title: string;
  criticality: string;
  currentHolder?: { id: string; firstName: string; lastName: string; jobTitle?: string | null } | null;
}

interface RolesWithoutSuccessorProps {
  data: RoleWithoutSuccessor[] | undefined;
  loading: boolean;
  isError: boolean;
  /** Undefined while the critical-roles read is pending or failed. 0 = no critical roles exist yet. */
  totalCriticalRoles: number | undefined;
  /** Opens AddSuccessorModal with this role chosen. */
  onAssign: (roleId: string) => void;
}

const CRIT_TONE: Record<string, StatusTone> = {
  critical: 'danger',
  high: 'warning',
  medium: 'info',
  low: 'neutral',
};

export function RolesWithoutSuccessor({
  data,
  loading,
  isError,
  totalCriticalRoles,
  onAssign,
}: RolesWithoutSuccessorProps) {
  const { t, locale } = useI18n();
  const critLabel = (crit: string): string => {
    if (crit === 'critical') return t.succession.critical;
    if (crit === 'high') return t.succession.high;
    if (crit === 'low') return t.succession.low;
    return t.succession.medium;
  };
  const items = data ?? [];

  let body: ReactNode;
  if (loading) {
    body = (
      <div aria-busy="true" className="space-y-2">
        <span className="sr-only">{t.common.loadingContent}</span>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    );
  } else if (isError) {
    body = <ErrorState size="compact" title={t.succession.loadError} />;
  } else if (items.length === 0) {
    // "All covered" is only true when critical roles exist; with none, say so instead.
    body =
      totalCriticalRoles === 0 ? (
        <EmptyState size="compact" title={t.succession.noRolesYet} description={t.succession.noRolesDesc} />
      ) : (
        <EmptyState
          size="compact"
          icon={
            <svg
              className="size-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
          }
          title={t.succession.rolesNoSuccessorEmpty}
          description={t.succession.rolesNoSuccessorEmptyDesc}
        />
      );
  } else {
    body = (
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-body">
          <thead>
            <tr className="bg-surface text-callout text-secondary">
              <th scope="col" className="px-3 py-2 font-semibold">
                {t.succession.colRole}
              </th>
              <th scope="col" className="px-3 py-2 font-semibold">
                {t.succession.colCurrentRole}
              </th>
              <th scope="col" className="px-3 py-2 font-semibold">
                {t.succession.colCriticality}
              </th>
              <th scope="col" className="px-3 py-2 font-semibold">
                <span className="sr-only">{t.succession.colAction}</span>
              </th>
            </tr>
          </thead>
          <tbody className="text-primary">
            {items.map((role) => (
              <tr key={role.id} className="border-t border-border">
                <td className="px-3 py-2 font-medium">{role.title}</td>
                <td className="px-3 py-2 text-secondary">{role.currentHolder?.jobTitle ?? ''}</td>
                <td className="px-3 py-2">
                  <StatusBadge tone={CRIT_TONE[role.criticality] ?? 'info'}>{critLabel(role.criticality)}</StatusBadge>
                </td>
                <td className="px-3 py-2 text-right">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onAssign(role.id)}
                    aria-label={formatMessage(t.succession.assignSuccessorFor, { role: role.title })}
                  >
                    {t.succession.assign}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <section aria-labelledby="roles-no-successor" className="rounded-xl border border-border bg-white p-4 shadow-card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="roles-no-successor" className="text-heading font-semibold text-brand">
          {t.succession.rolesNoSuccessor}
        </h2>
        {!loading && !isError && items.length > 0 && (
          <StatusBadge tone="danger">{pluralize(items.length, t.succession.rolesUncoveredCount, locale)}</StatusBadge>
        )}
      </div>
      {body}
    </section>
  );
}
