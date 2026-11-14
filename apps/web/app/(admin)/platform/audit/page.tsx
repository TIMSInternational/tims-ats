'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { formatMessage, useI18n } from '../../../../lib/i18n';
import { Button, EmptyState, ErrorState, PageHeader, Skeleton } from '../../../../components';
import { useAuditLogs, useAuditLogsExport } from '../../../../lib/platform-api/audit-log';
import { AuditFilters, type AuditFilterValues } from './audit-filters';
import { AuditTable } from './audit-table';

const NO_FILTERS: AuditFilterValues = { action: '', entity: '', organizationId: '', dateFrom: '', dateTo: '' };
const LIMIT = 15;

export default function AuditPage() {
  const { t } = useI18n();
  const au = t.audit;
  const [filters, setFilters] = useState<AuditFilterValues>(NO_FILTERS);
  const [exporting, setExporting] = useState<'csv' | 'json' | null>(null);

  const orgs = trpc.platform.listOrganizationsMinimal.useQuery();
  const fetchAuditLogsExport = useAuditLogsExport();

  const query = {
    action: filters.action || undefined,
    entity: filters.entity || undefined,
    organizationId: filters.organizationId || undefined,
    dateFrom: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
    dateTo: filters.dateTo ? new Date(filters.dateTo) : undefined,
  };
  const { data, isLoading, isError, error, refetch } = useAuditLogs({ ...query, limit: LIMIT });

  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;
  const hasActiveFilters = Object.values(filters).some(Boolean);

  const handleExport = async (format: 'csv' | 'json') => {
    if (exporting) return;
    setExporting(format);
    try {
      const result = await fetchAuditLogsExport({ ...query, format });
      const mime = format === 'json' ? 'application/json' : 'text/csv;charset=utf-8;';
      const blob = new Blob([result.data], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      toast(formatMessage(au.exportDone, { count: result.count }), { type: 'success' });
    } catch {
      toast(t.common.exportError, { type: 'error' });
    } finally {
      setExporting(null);
    }
  };

  const clearFilters = () => setFilters(NO_FILTERS);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={t.platformSidebar.audit}
        description={au.pageDescription}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => handleExport('csv')}
              disabled={exporting !== null && exporting !== 'csv'}
              loading={exporting === 'csv'}
              loadingLabel={t.common.exporting}
            >
              {au.exportCsv}
            </Button>
            <Button
              variant="secondary"
              onClick={() => handleExport('json')}
              disabled={exporting !== null && exporting !== 'json'}
              loading={exporting === 'json'}
              loadingLabel={t.common.exporting}
            >
              {au.exportJson}
            </Button>
          </>
        }
      />
      <div className="flex-1 space-y-4 overflow-y-auto p-4 md:p-6">
        <AuditFilters
          values={filters}
          onChange={(patch) => setFilters((prev) => ({ ...prev, ...patch }))}
          onClear={clearFilters}
          orgs={orgs.data ?? []}
          isOrgsError={orgs.isError}
          orgsError={orgs.error}
          onRetryOrgs={() => orgs.refetch()}
        />

        <div className="overflow-hidden rounded-xl bg-white shadow-card">
          {isLoading ? (
            <div aria-busy="true" className="divide-y divide-border">
              <span className="sr-only">{t.common.loadingContent}</span>
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-5 py-3">
                  <Skeleton className="h-3 w-28" />
                  <Skeleton className="size-6 rounded-full" />
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-4 w-14 rounded-full" />
                  <Skeleton className="h-3 flex-1" />
                </div>
              ))}
            </div>
          ) : isError ? (
            <ErrorState onRetry={() => refetch()} error={error} message={au.loadError} />
          ) : logs.length === 0 ? (
            hasActiveFilters ? (
              <EmptyState
                title={au.noMatches}
                description={au.noLogsDesc}
                action={{ label: t.common.clearFilters, onClick: clearFilters, variant: 'secondary' }}
              />
            ) : (
              <EmptyState title={au.noLogs} description={au.noLogsYetDesc} />
            )
          ) : (
            <AuditTable logs={logs} total={total} />
          )}
        </div>
      </div>
    </div>
  );
}
