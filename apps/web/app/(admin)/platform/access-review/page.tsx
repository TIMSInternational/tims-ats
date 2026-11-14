'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { formatMessage, useI18n } from '../../../../lib/i18n';
import { Button, EmptyState, ErrorState, KpiCard, KpiCardSkeleton, PageHeader, Select } from '../../../../components';
import {
  useAccessReview,
  useAccessReviewAttestations,
  useAccessReviewExport,
} from '../../../../lib/platform-api/access-review';
import { AttestModal } from './attest-modal';
import { AccessReportTable } from './access-report-table';
import { AttestationHistory } from './attestation-history';

export default function AccessReviewPage() {
  const { t } = useI18n();
  const ar = t.accessReview;
  const [organizationId, setOrganizationId] = useState('');
  const [showAttestModal, setShowAttestModal] = useState(false);
  const [exporting, setExporting] = useState(false);

  const orgs = trpc.platform.listOrganizationsMinimal.useQuery();
  const review = useAccessReview(organizationId);
  const history = useAccessReviewAttestations(organizationId, 20);
  const fetchExport = useAccessReviewExport();

  const handleExport = async () => {
    if (!organizationId || exporting) return;
    setExporting(true);
    try {
      const result = await fetchExport(organizationId);
      const blob = new Blob([result.data], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `access-review-${organizationId}-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast(formatMessage(ar.exportDone, { count: result.count }), { type: 'success' });
    } catch {
      toast(t.common.exportError, { type: 'error' });
    } finally {
      setExporting(false);
    }
  };

  const report = review.data;
  const deprovisionGaps = report?.summary.deprovisionGapCount ?? 0;
  const expiredGaps = report?.summary.expiredGapCount ?? 0;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={t.platformSidebar.accessReview}
        description={ar.pageDescription}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={handleExport}
              disabled={!organizationId || review.isLoading}
              loading={exporting}
              loadingLabel={t.common.exporting}
            >
              {ar.exportCsv}
            </Button>
            <Button
              onClick={() => setShowAttestModal(true)}
              disabled={!organizationId || review.isLoading || review.isError}
            >
              {ar.attestAction}
            </Button>
          </>
        }
      />
      <div className="flex-1 space-y-4 overflow-y-auto p-4 md:p-6">
        <div className="w-full sm:max-w-sm">
          <label htmlFor="access-review-org" className="mb-1.5 block text-body font-medium text-primary">
            {ar.orgLabel}
          </label>
          {orgs.isError ? (
            <ErrorState size="inline" onRetry={() => orgs.refetch()} error={orgs.error} message={ar.orgsLoadError} />
          ) : (
            <Select id="access-review-org" value={organizationId} onChange={(e) => setOrganizationId(e.target.value)}>
              <option value="">{ar.selectOrgPlaceholder}</option>
              {(orgs.data ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          )}
        </div>

        {!organizationId ? (
          <div className="rounded-xl bg-white shadow-card">
            <EmptyState title={ar.selectOrgTitle} description={ar.selectOrgPrompt} />
          </div>
        ) : (
          <>
            {review.isLoading ? (
              <div aria-busy="true" className="grid grid-cols-2 gap-4 md:grid-cols-5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <KpiCardSkeleton key={i} />
                ))}
              </div>
            ) : review.isError ? (
              <div className="rounded-xl bg-white shadow-card">
                <ErrorState onRetry={() => review.refetch()} error={review.error} message={ar.loadError} />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
                <KpiCard label={ar.kpiUsers} value={report?.summary.userCount ?? 0} />
                <KpiCard label={ar.kpiPrivileged} value={report?.summary.privilegedCount ?? 0} />
                <KpiCard label={ar.kpiStale} value={report?.summary.staleCount ?? 0} tone="warning" />
                <KpiCard
                  label={ar.kpiDeprovisionGap}
                  value={deprovisionGaps}
                  tone="danger"
                  highlight={deprovisionGaps > 0}
                />
                <KpiCard label={ar.kpiExpiredGrant} value={expiredGaps} tone="danger" highlight={expiredGaps > 0} />
              </div>
            )}

            {report?.truncated && (
              <p role="status" className="rounded-lg bg-warning-bg px-3 py-2 text-callout text-warning">
                {ar.truncatedWarning}
              </p>
            )}

            {!review.isLoading && !review.isError && report && <AccessReportTable report={report} />}

            <AttestationHistory history={history} />
          </>
        )}
      </div>

      {showAttestModal && organizationId && (
        <AttestModal organizationId={organizationId} onClose={() => setShowAttestModal(false)} />
      )}
    </div>
  );
}
