'use client';

import { formatMessage, useI18n } from '../../../../lib/i18n';
import { getAvatarColor, getInitials, intlLocale } from '../../../../lib/format-utils';
import { StatusBadge } from '../../../../components';
import type { useAuditLogs } from '../../../../lib/platform-api/audit-log';
import { actionTone } from './audit-options';

type AuditLog = NonNullable<ReturnType<typeof useAuditLogs>['data']>['logs'][number];

const TH = 'px-5 py-3 text-left text-callout font-medium text-secondary';

/** The audit rows plus an honest footer: it counts what is shown, since this view does not page. */
export function AuditTable({ logs, total }: { logs: AuditLog[]; total: number }) {
  const { t, locale } = useI18n();
  const au = t.audit;
  const actions = au.actions as Record<string, string>;
  const entities = au.entities as Record<string, string>;
  const timeFormat = new Intl.DateTimeFormat(intlLocale(locale), {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px]" aria-label={au.tableLabel}>
          <thead>
            <tr className="border-b border-border">
              <th className={TH}>{au.colDateTime}</th>
              <th className={TH}>{au.colActor}</th>
              <th className={TH}>{au.colAction}</th>
              <th className={TH}>{au.colEntity}</th>
              <th className={TH}>{au.colDetail}</th>
              <th className={TH}>{au.colIp}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {logs.map((log) => {
              const actorName = log.actor
                ? `${log.actor.firstName} ${log.actor.lastName}`.trim() || log.actor.email
                : (log.userId ?? au.system);
              return (
                <tr key={log.id} className="hover:bg-surface-hover">
                  <td className="whitespace-nowrap px-5 py-3 text-body tabular-nums text-secondary">
                    {timeFormat.format(new Date(log.createdAt))}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <div
                        aria-hidden="true"
                        className={`flex size-6 shrink-0 items-center justify-center rounded-full text-caption font-semibold text-white ${getAvatarColor(actorName)}`}
                      >
                        {getInitials(actorName)}
                      </div>
                      <span className="text-body text-primary">{actorName}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <StatusBadge tone={actionTone(log.action)} icon="none">
                      {actions[log.action] ?? log.action}
                    </StatusBadge>
                  </td>
                  <td className="px-5 py-3 text-body text-secondary">
                    {log.entity ? (entities[log.entity] ?? log.entity) : '—'}
                  </td>
                  <td
                    className="max-w-[200px] truncate px-5 py-3 text-body text-secondary"
                    title={log.entityId ?? undefined}
                  >
                    {log.entityId ?? '—'}
                  </td>
                  <td className="px-5 py-3 font-mono text-callout text-secondary">{log.ipAddress ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3 text-callout text-secondary">
        <span className="tabular-nums">
          {formatMessage(t.common.showingRange, { from: logs.length > 0 ? 1 : 0, to: logs.length, total })}
        </span>
        {total > logs.length && <span>{au.refineFilters}</span>}
      </div>
    </>
  );
}
