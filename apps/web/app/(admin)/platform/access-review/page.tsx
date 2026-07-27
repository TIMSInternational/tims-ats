'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { KpiCard, KpiCardSkeleton, ErrorState, StatusBadge } from '../../../../components';
import {
  useAccessReview,
  useAccessReviewAttestations,
  useAccessReviewExport,
} from '../../../../lib/platform-api/access-review';
import { AttestModal } from './attest-modal';

function FlagBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-700 whitespace-nowrap">
      {label}
    </span>
  );
}

function formatDate(d: Date) {
  return d.toLocaleDateString('es-CO', { year: 'numeric', month: 'short', day: '2-digit' });
}

export default function AccessReviewPage() {
  const { t } = useI18n();
  const ar = t.accessReview;
  const statusMap: Record<string, { cls: string; label: string }> = {
    active: { cls: 'bg-green-100 text-green-700', label: ar.statusActive },
    inactive: { cls: 'bg-gray-100 text-gray-600', label: ar.statusInactive },
    deleted: { cls: 'bg-red-100 text-red-700', label: ar.statusDeleted },
  };
  const [organizationId, setOrganizationId] = useState('');
  const [showAttestModal, setShowAttestModal] = useState(false);

  const orgs = trpc.platform.listOrganizationsMinimal.useQuery();
  const review = useAccessReview(organizationId);
  const history = useAccessReviewAttestations(organizationId, 20);
  const fetchExport = useAccessReviewExport();

  const handleExport = async () => {
    if (!organizationId) return;
    const result = await fetchExport(organizationId);
    const blob = new Blob([result.data], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `access-review-${organizationId}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast(`${ar.exportCsv}: ${result.count}`, { type: 'success' });
  };

  const report = review.data;
  const attestations = history.data ?? [];

  return (
    <div className="h-full overflow-y-auto p-6 space-y-4">
      {/* Org selector + actions */}
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4 flex items-center gap-3">
        {orgs.isError ? (
          <ErrorState onRetry={() => orgs.refetch()} />
        ) : (
          <select
            value={organizationId}
            onChange={(e) => setOrganizationId(e.target.value)}
            className="border border-[#EDEDED] rounded-lg px-3 py-2 text-sm text-[#585858] bg-white min-w-[240px]"
          >
            <option value="">{ar.selectOrgPlaceholder}</option>
            {(orgs.data ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        )}
        <div className="flex-1" />
        <button
          onClick={handleExport}
          disabled={!organizationId || review.isLoading}
          className="flex items-center gap-2 px-4 py-2 border border-[#EDEDED] rounded-lg text-sm text-[#585858] hover:bg-[#F6F6F6] transition disabled:opacity-50"
        >
          {ar.exportCsv}
        </button>
        <button
          onClick={() => setShowAttestModal(true)}
          disabled={!organizationId || review.isLoading || review.isError}
          className="px-4 py-2 rounded-lg text-sm bg-[#DD0C15] text-white font-medium hover:bg-red-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {ar.attestAction}
        </button>
      </div>

      {!organizationId ? (
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] py-16 text-center">
          <p className="text-sm text-[#8B8B8B]">{ar.selectOrgPrompt}</p>
        </div>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {review.isLoading ? (
              Array.from({ length: 5 }).map((_, i) => <KpiCardSkeleton key={i} />)
            ) : review.isError ? (
              <div className="col-span-5">
                <ErrorState onRetry={() => review.refetch()} />
              </div>
            ) : (
              <>
                <KpiCard
                  label={ar.kpiUsers}
                  value={report?.summary.userCount ?? 0}
                  icon={<span />}
                  iconBg="bg-[#F3F1FA]"
                />
                <KpiCard
                  label={ar.kpiPrivileged}
                  value={report?.summary.privilegedCount ?? 0}
                  icon={<span />}
                  iconBg="bg-purple-100"
                />
                <KpiCard
                  label={ar.kpiStale}
                  value={report?.summary.staleCount ?? 0}
                  icon={<span />}
                  iconBg="bg-amber-100"
                />
                <KpiCard
                  label={ar.kpiDeprovisionGap}
                  value={report?.summary.deprovisionGapCount ?? 0}
                  icon={<span />}
                  iconBg="bg-red-100"
                  highlight={(report?.summary.deprovisionGapCount ?? 0) > 0}
                />
                <KpiCard
                  label={ar.kpiExpiredGrant}
                  value={report?.summary.expiredGapCount ?? 0}
                  icon={<span />}
                  iconBg="bg-red-100"
                  highlight={(report?.summary.expiredGapCount ?? 0) > 0}
                />
              </>
            )}
          </div>

          {report?.truncated && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              {ar.truncatedWarning}
            </p>
          )}

          {/* Report table */}
          {!review.isLoading && !review.isError && (
            <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
              {report && report.rows.length === 0 ? (
                <div className="py-16 text-center">
                  <p className="text-sm text-[#8B8B8B]">{ar.noRows}</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px]">
                    <thead>
                      <tr className="border-b border-[#EDEDED]">
                        <th className="text-left text-[11px] text-[#8B8B8B] uppercase tracking-wider font-medium px-5 py-3">
                          {ar.colUser}
                        </th>
                        <th className="text-left text-[11px] text-[#8B8B8B] uppercase tracking-wider font-medium px-5 py-3">
                          {ar.colStatus}
                        </th>
                        <th className="text-left text-[11px] text-[#8B8B8B] uppercase tracking-wider font-medium px-5 py-3">
                          {ar.colRoles}
                        </th>
                        <th className="text-left text-[11px] text-[#8B8B8B] uppercase tracking-wider font-medium px-5 py-3">
                          {ar.colFlags}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EDEDED]">
                      {report?.rows.map((row) => (
                        <tr key={row.userId} className="hover:bg-[#FAFAFA]/50 align-top">
                          <td className="px-5 py-3">
                            <div className="text-sm text-[#333] font-medium">{row.name}</div>
                            <div className="text-xs text-[#8B8B8B]">{row.email}</div>
                          </td>
                          <td className="px-5 py-3">
                            <StatusBadge status={row.status} map={statusMap} />
                          </td>
                          <td className="px-5 py-3 text-xs text-[#585858]">
                            {row.roles.length === 0 ? '--' : row.roles.map((r) => r.slug).join(', ')}
                          </td>
                          <td className="px-5 py-3">
                            <div className="flex flex-wrap gap-1">
                              {row.flags.privileged && <FlagBadge label={ar.flagPrivileged} />}
                              {row.flags.stale && <FlagBadge label={ar.flagStale} />}
                              {row.flags.neverLoggedIn && <FlagBadge label={ar.flagNeverLoggedIn} />}
                              {row.flags.deprovisionGap && <FlagBadge label={ar.flagDeprovisionGap} />}
                              {row.flags.expiredGrant && <FlagBadge label={ar.flagExpiredGrant} />}
                              {row.flags.crossOrgRole && <FlagBadge label={ar.flagCrossOrg} />}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Attestation history */}
          <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
            <div className="px-5 py-3 border-b border-[#EDEDED]">
              <h3 className="text-[13px] font-semibold text-[#1F114C]">{ar.historyTitle}</h3>
            </div>
            {history.isLoading ? (
              <div className="p-5 text-sm text-[#8B8B8B]">...</div>
            ) : history.isError ? (
              <ErrorState onRetry={() => history.refetch()} />
            ) : attestations.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-sm text-[#8B8B8B]">{ar.historyEmpty}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px]">
                  <thead>
                    <tr className="border-b border-[#EDEDED]">
                      <th className="text-left text-[11px] text-[#8B8B8B] uppercase tracking-wider font-medium px-5 py-3">
                        {ar.historyColDate}
                      </th>
                      <th className="text-left text-[11px] text-[#8B8B8B] uppercase tracking-wider font-medium px-5 py-3">
                        {ar.historyColReviewer}
                      </th>
                      <th className="text-left text-[11px] text-[#8B8B8B] uppercase tracking-wider font-medium px-5 py-3">
                        {ar.historyColUsers}
                      </th>
                      <th className="text-left text-[11px] text-[#8B8B8B] uppercase tracking-wider font-medium px-5 py-3">
                        {ar.historyColPrivileged}
                      </th>
                      <th className="text-left text-[11px] text-[#8B8B8B] uppercase tracking-wider font-medium px-5 py-3">
                        {ar.historyColNotes}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EDEDED]">
                    {attestations.map((a) => (
                      <tr key={a.id} className="hover:bg-[#FAFAFA]/50">
                        <td className="px-5 py-3 text-xs text-[#8B8B8B] whitespace-nowrap">
                          {formatDate(a.reviewedAt)}
                        </td>
                        <td className="px-5 py-3 text-sm text-[#585858]">
                          {a.reviewer.firstName} {a.reviewer.lastName}
                        </td>
                        <td className="px-5 py-3 text-sm text-[#585858]">{a.userCount}</td>
                        <td className="px-5 py-3 text-sm text-[#585858]">{a.privilegedCount}</td>
                        <td className="px-5 py-3 text-xs text-[#8B8B8B] max-w-[240px] truncate">{a.notes ?? '--'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {showAttestModal && organizationId && (
        <AttestModal organizationId={organizationId} onClose={() => setShowAttestModal(false)} />
      )}
    </div>
  );
}
