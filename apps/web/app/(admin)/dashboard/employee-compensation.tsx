'use client';

import { useId } from 'react';
import { useCompensationMyCompensation } from '../../../lib/platform-api/compensation';
import { useI18n } from '../../../lib/i18n';
import { EmptyState, Skeleton } from '../../../components';
import { LoadError } from './load-error';
import { formatCurrency } from '../../../lib/format-utils';

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="-mx-3 flex items-center justify-between gap-3 rounded-lg px-3 py-2.5">
      <dt className="text-body text-secondary">{label}</dt>
      <dd className="text-body font-medium tabular-nums text-primary">{value}</dd>
    </div>
  );
}

// "Mi Compensacion" — OWN-scoped, sensitive. The endpoint field-gates the DTO via
// selectFor, so for an employee role only the entitled fields (currentSalary, and
// band when entitled) are present; compaRatio/variablePay are ABSENT (not null)
// and simply not rendered. Treated as sensitive: no console logging. A missing
// comp row → null → "No disponible".
export function EmployeeCompensation() {
  const { t } = useI18n();
  const e = t.employeeHome;
  const comp = useCompensationMyCompensation();
  const data = comp.data;
  const titleId = useId();

  const rows: { label: string; value: string }[] = [];
  if (data) {
    const currency = data.currency ?? 'USD';
    if (typeof data.currentSalary === 'number') {
      rows.push({ label: e.compSalary, value: formatCurrency(data.currentSalary, currency) });
    }
    if (typeof data.variablePay === 'number') {
      rows.push({ label: e.compVariablePay, value: formatCurrency(data.variablePay, currency) });
    }
    if (typeof data.compaRatio === 'number') {
      rows.push({ label: e.compCompaRatio, value: data.compaRatio.toFixed(2) });
    }
    if (data.band) {
      rows.push({
        label: e.compBand,
        value: data.band.title ?? data.band.level ?? '—',
      });
    }
  }

  return (
    <section aria-labelledby={titleId} className="rounded-xl bg-white p-5 shadow-card">
      <h2 id={titleId} className="mb-4 text-heading font-semibold text-brand">
        {e.compensation}
      </h2>
      {comp.isError ? (
        <LoadError message={e.loadError} onRetry={() => comp.refetch()} />
      ) : comp.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      ) : !data || rows.length === 0 ? (
        <EmptyState size="compact" message={e.compUnavailable} />
      ) : (
        <dl className="space-y-1">
          {rows.map((row) => (
            <FieldRow key={row.label} label={row.label} value={row.value} />
          ))}
        </dl>
      )}
    </section>
  );
}
