'use client';

import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { EmptyState, Skeleton } from '../../../components';
import { LoadError } from './load-error';
import { formatCurrency } from '../../../lib/format-utils';

const EMPTY_ICON = (
  <span className="w-8 h-8 rounded-full bg-[#F0F0F0] inline-block" aria-hidden />
);

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg px-3 py-2.5 -mx-3">
      <span className="text-sm text-[#585858]">{label}</span>
      <span className="text-sm text-[#333] font-medium">{value}</span>
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
  const comp = trpc.compensation.myCompensation.useQuery();
  const data = comp.data;

  const rows: { label: string; value: string }[] = [];
  if (data) {
    if (typeof data.currentSalary === 'number') {
      rows.push({ label: e.compSalary, value: formatCurrency(data.currentSalary) });
    }
    if (typeof data.variablePay === 'number') {
      rows.push({ label: e.compVariablePay, value: formatCurrency(data.variablePay) });
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
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 mb-8">
      <h2 className="text-sm font-semibold text-[#1F114C] mb-4">{e.compensation}</h2>
      {comp.isError ? (
        <LoadError message={e.loadError} />
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
        <EmptyState icon={EMPTY_ICON} message={e.compUnavailable} />
      ) : (
        <div className="space-y-1">
          {rows.map((row) => (
            <FieldRow key={row.label} label={row.label} value={row.value} />
          ))}
        </div>
      )}
    </div>
  );
}
