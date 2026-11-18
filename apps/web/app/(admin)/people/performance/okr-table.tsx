'use client';

import { useI18n, formatMessage } from '../../../../lib/i18n';
import { intlLocale } from '../../../../lib/format-utils';
import { CandidateAvatar, EmptyState, ErrorState, ProgressBar, Skeleton, StatusBadge } from '../../../../components';
import type { StatusTone } from '../../../../components';

interface OkrUser {
  id: string;
  firstName: string;
  lastName: string;
  avatar: string | null;
}

interface OkrTeam {
  id: string;
  name: string;
}

export interface OkrItem {
  id: string;
  title: string;
  progress: number;
  user: OkrUser | null;
  team: OkrTeam | null;
}

interface TeamGroup {
  team: string;
  rows: OkrItem[];
}

type StatusKey = 'legendOnTarget' | 'legendAtRisk' | 'legendCritical';

/** Status is always a word plus an icon, never a coloured dot alone (accessibility.md › Vision). */
function getStatus(pct: number): { tone: StatusTone; labelKey: StatusKey } {
  if (pct >= 70) return { tone: 'success', labelKey: 'legendOnTarget' };
  if (pct >= 40) return { tone: 'warning', labelKey: 'legendAtRisk' };
  return { tone: 'danger', labelKey: 'legendCritical' };
}

function groupByTeam(rows: OkrItem[], noTeam: string): TeamGroup[] {
  const map = new Map<string, OkrItem[]>();
  rows.forEach((r) => {
    const teamName = r.team?.name ?? noTeam;
    const arr = map.get(teamName) || [];
    arr.push(r);
    map.set(teamName, arr);
  });
  return Array.from(map.entries()).map(([team, items]) => ({ team, rows: items }));
}

interface OkrTableProps {
  okrs: OkrItem[];
  isLoading: boolean;
  isError?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** Shown as the empty state's action when the viewer may create OKRs. */
  onCreate?: () => void;
}

const CARD = 'overflow-hidden rounded-xl border border-border bg-white shadow-card';

export function OkrTable({ okrs, isLoading, isError, error, onRetry, onCreate }: OkrTableProps) {
  const { t, locale } = useI18n();

  if (isLoading) {
    return (
      <div className={CARD} aria-busy="true">
        <span className="sr-only">{t.common.loadingContent}</span>
        <div className="border-b border-border px-4 py-3 md:px-5">
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="space-y-3 p-4 md:p-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="size-6 rounded-full" />
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-1.5 flex-1" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className={CARD}>
        <ErrorState error={error} onRetry={onRetry} />
      </div>
    );
  }

  const heading = (
    <div className="border-b border-border px-4 py-3 md:px-5">
      <h2 className="text-subheading font-semibold text-primary">{t.performance.okrProgressTitle}</h2>
    </div>
  );

  if (okrs.length === 0) {
    return (
      <section className={CARD}>
        {heading}
        <EmptyState
          title={t.performance.noOkrs}
          description={t.performance.noOkrsDesc}
          action={onCreate ? { label: t.performance.newOkr, onClick: onCreate, variant: 'secondary' } : undefined}
        />
      </section>
    );
  }

  const groups = groupByTeam(okrs, t.performance.noTeam);
  const alerts = okrs.filter((r) => r.progress < 35);
  const nameOf = (r: OkrItem) => (r.user ? `${r.user.firstName} ${r.user.lastName}` : t.performance.unknownPerson);
  const alertNames = new Intl.ListFormat(intlLocale(locale), { type: 'conjunction' }).format(
    alerts.map((a) => `${nameOf(a)} (${a.progress} %)`),
  );

  return (
    <section className={CARD}>
      {heading}

      {/* Phones: a stacked list (foundation §7); the table appears from md. */}
      <ul className="divide-y divide-border md:hidden">
        {okrs.map((row) => {
          const status = getStatus(row.progress);
          return (
            <li key={row.id} className="space-y-2 px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  {row.user && (
                    <CandidateAvatar
                      firstName={row.user.firstName}
                      lastName={row.user.lastName}
                      avatar={row.user.avatar}
                      size="xs"
                      decorative
                    />
                  )}
                  <span className="truncate text-body font-medium text-primary">{nameOf(row)}</span>
                </div>
                <StatusBadge tone={status.tone}>{t.performance[status.labelKey]}</StatusBadge>
              </div>
              <p className="text-body text-secondary">{row.title}</p>
              <ProgressBar
                value={row.progress}
                label={formatMessage(t.performance.progressOf, { name: nameOf(row) })}
                hideLabel
                tone="brand"
              />
              <p className="text-callout tabular-nums text-secondary">
                {row.team?.name ?? t.performance.noTeam} · {row.progress} %
              </p>
            </li>
          );
        })}
      </ul>

      <table className="hidden w-full text-body md:table">
        <thead>
          <tr className="bg-surface text-left text-callout font-medium text-secondary">
            <th scope="col" className="px-5 py-2.5 font-medium">
              {t.performance.colEmployee}
            </th>
            <th scope="col" className="px-3 py-2.5 font-medium">
              {t.performance.colTeam}
            </th>
            <th scope="col" className="px-3 py-2.5 font-medium">
              {t.performance.colObjective}
            </th>
            <th scope="col" className="w-36 px-3 py-2.5 font-medium">
              {t.performance.colProgress}
            </th>
            <th scope="col" className="w-28 px-3 py-2.5 font-medium">
              {t.performance.colStatus}
            </th>
          </tr>
        </thead>
        <tbody className="text-primary">
          {groups.map((g) => (
            <TeamRows key={g.team} group={g} nameOf={nameOf} />
          ))}
        </tbody>
      </table>

      {alerts.length > 0 && (
        <div className="flex items-start gap-2 border-t border-border bg-danger-bg px-4 py-3 md:px-5" role="note">
          <svg
            className="mt-0.5 size-4 shrink-0 text-danger"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
            <path d="M12 15.75h.007v.008H12v-.008z" />
          </svg>
          <p className="text-callout text-danger">
            <span className="font-semibold">{t.performance.alertLabel}</span>{' '}
            {formatMessage(t.performance.alertMessage, { names: alertNames })}
          </p>
        </div>
      )}
    </section>
  );
}

function TeamRows({ group, nameOf }: { group: TeamGroup; nameOf: (r: OkrItem) => string }) {
  const { t } = useI18n();
  return (
    <>
      <tr className="bg-surface">
        <th scope="colgroup" colSpan={5} className="px-5 py-1.5 text-left text-callout font-semibold text-brand">
          {group.team}
        </th>
      </tr>
      {group.rows.map((row) => {
        const status = getStatus(row.progress);
        return (
          <tr key={row.id} className="border-b border-border">
            <td className="px-5 py-2.5">
              <div className="flex items-center gap-2">
                {row.user && (
                  <CandidateAvatar
                    firstName={row.user.firstName}
                    lastName={row.user.lastName}
                    avatar={row.user.avatar}
                    size="xs"
                    decorative
                  />
                )}
                <span className="font-medium">{nameOf(row)}</span>
              </div>
            </td>
            <td className="px-3 py-2.5 text-secondary">{row.team?.name ?? ''}</td>
            <td className="px-3 py-2.5">{row.title}</td>
            <td className="px-3 py-2.5">
              <div className="flex items-center gap-2">
                <ProgressBar
                  value={row.progress}
                  label={formatMessage(t.performance.progressOf, { name: nameOf(row) })}
                  hideLabel
                  className="flex-1"
                />
                <span className="w-10 text-right text-callout tabular-nums text-secondary">{row.progress} %</span>
              </div>
            </td>
            <td className="px-3 py-2.5">
              <StatusBadge tone={status.tone}>{t.performance[status.labelKey]}</StatusBadge>
            </td>
          </tr>
        );
      })}
    </>
  );
}
