'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { Button, Field, PageHeader, Select, TextInput } from '../../../../components';
import { useTenantAuditExport } from '../../../../lib/platform-api/tenant-audit';
import { timeZoneLabel } from '@tims/shared';
import {
  AUDIT_ACTION_CODES,
  AUDIT_ENTITY_CODES,
  auditExportRange,
  auditFilterOptions,
  isAuditRangeInverted,
} from '../../../../lib/audit-export-filters';

function downloadBlob(data: string, format: 'csv' | 'json') {
  const mime = format === 'json' ? 'application/json' : 'text/csv;charset=utf-8;';
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.${format}`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AuditLogExportPage() {
  const { t, locale } = useI18n();
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [action, setAction] = useState('');
  const [entity, setEntity] = useState('');
  const [actorId, setActorId] = useState('');
  const [pendingFormat, setPendingFormat] = useState<'csv' | 'json' | null>(null);

  const users = trpc.user.list.useQuery({ limit: 100 });
  // The organization's zone decides where a chosen day starts and ends (D-13); null falls back to UTC.
  const org = trpc.organization.getCurrent.useQuery(undefined, { retry: false });
  const timeZone = org.data?.timeZone ?? null;
  const exportMutation = useTenantAuditExport();
  const actionOptions = auditFilterOptions(AUDIT_ACTION_CODES, t.auditExport.actions);
  const entityOptions = auditFilterOptions(AUDIT_ENTITY_CODES, t.auditExport.entities);
  const rangeInverted = isAuditRangeInverted(dateFrom, dateTo);
  const zoneText = timeZoneLabel(timeZone ?? 'UTC', locale === 'EN' ? 'en' : 'es');

  const clearFilters = () => {
    setDateFrom('');
    setDateTo('');
    setAction('');
    setEntity('');
    setActorId('');
  };

  const handleExport = async (format: 'csv' | 'json') => {
    if (rangeInverted) return;
    const range = auditExportRange(dateFrom, dateTo, timeZone);
    setPendingFormat(format);
    try {
      const result = await exportMutation.mutateAsync({
        format,
        dateFrom: range.dateFrom,
        dateTo: range.dateTo,
        action: action || undefined,
        entity: entity || undefined,
        actorId: actorId || undefined,
      });
      downloadBlob(result.data, result.format);
      if (result.truncated) {
        toast(t.auditExport.exportTruncated.replace('{count}', String(result.count)), { type: 'info' });
      } else {
        toast(t.auditExport.exportSuccess.replace('{count}', String(result.count)), { type: 'success' });
      }
    } catch {
      toast(t.auditExport.exportError, { type: 'error' });
    } finally {
      setPendingFormat(null);
    }
  };

  const isExporting = exportMutation.isPending || org.isLoading;
  const downloadIcon = (
    <svg className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </svg>
  );

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <PageHeader title={t.auditExport.title} description={t.auditExport.description} />

      <div className="flex-1 overflow-y-auto px-4 py-5 md:px-6 md:py-6">
        <div className="max-w-3xl rounded-xl bg-white p-5 shadow-card">
          <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field id="audit-date-from" label={t.auditExport.dateFrom}>
              {(control) => (
                <TextInput
                  {...control}
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  aria-invalid={rangeInverted || undefined}
                  aria-describedby="audit-date-note"
                />
              )}
            </Field>
            <Field id="audit-date-to" label={t.auditExport.dateTo}>
              {(control) => (
                <TextInput
                  {...control}
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  aria-invalid={rangeInverted || undefined}
                  aria-describedby="audit-date-note"
                />
              )}
            </Field>
            <p id="audit-date-note" className="-mt-2 text-callout text-secondary md:col-span-2">
              {t.auditExport.timeZoneNote.replace('{zone}', zoneText)}
            </p>
            {rangeInverted && (
              <p role="alert" className="-mt-2 text-callout text-danger md:col-span-2">
                {t.auditExport.dateRangeInvalid}
              </p>
            )}
            <Field id="audit-action" label={t.auditExport.actionLabel}>
              <Select value={action} onChange={(e) => setAction(e.target.value)}>
                <option value="">{t.auditExport.actionPlaceholder}</option>
                {actionOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="audit-entity" label={t.auditExport.entityLabel}>
              <Select value={entity} onChange={(e) => setEntity(e.target.value)}>
                <option value="">{t.auditExport.entityPlaceholder}</option>
                {entityOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="audit-actor" label={t.auditExport.actorLabel}>
              <Select
                value={actorId}
                onChange={(e) => setActorId(e.target.value)}
                disabled={users.isLoading}
                aria-busy={users.isLoading || undefined}
              >
                <option value="">{users.isLoading ? t.auditExport.loadingActors : t.auditExport.allActors}</option>
                {(users.data?.users ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.firstName} {u.lastName} ({u.email})
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
            <Button variant="tertiary" onClick={clearFilters} fullWidth className="sm:w-auto">
              {t.auditExport.clearFilters}
            </Button>
            <Button
              variant="secondary"
              onClick={() => handleExport('json')}
              disabled={(isExporting && pendingFormat !== 'json') || rangeInverted}
              loading={pendingFormat === 'json'}
              loadingLabel={t.auditExport.exportingJson}
              icon={downloadIcon}
              fullWidth
              className="sm:w-auto"
            >
              {t.auditExport.exportJson}
            </Button>
            <Button
              onClick={() => handleExport('csv')}
              disabled={(isExporting && pendingFormat !== 'csv') || rangeInverted}
              loading={pendingFormat === 'csv'}
              loadingLabel={t.auditExport.exportingCsv}
              icon={downloadIcon}
              fullWidth
              className="sm:w-auto"
            >
              {t.auditExport.exportCsv}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
