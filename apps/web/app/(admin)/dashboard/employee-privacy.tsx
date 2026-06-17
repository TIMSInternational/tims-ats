'use client';

import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { EmptyState, Skeleton } from '../../../components';
import { LoadError } from './load-error';
import { formatDate } from '../../../lib/format-utils';

const EMPTY_ICON = (
  <span className="w-8 h-8 rounded-full bg-[#F0F0F0] inline-block" aria-hidden />
);

function SkeletonRows() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="flex items-center justify-between">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </div>
  );
}

// "Privacidad" — OWN-scoped, READ-ONLY consent ledger. Lists the caller's consent
// types with active/withdrawn status + text version. Grant/withdraw mutations are
// a follow-up slice.
export function EmployeePrivacy() {
  const { t } = useI18n();
  const e = t.employeeHome;
  const consents = trpc.consent.myConsents.useQuery();
  const list = consents.data ?? [];

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
      <h2 className="text-sm font-semibold text-[#1F114C] mb-4">{e.privacy}</h2>
      {consents.isError ? (
        <LoadError message={e.loadError} />
      ) : consents.isLoading ? (
        <SkeletonRows />
      ) : list.length === 0 ? (
        <EmptyState icon={EMPTY_ICON} message={e.noConsents} />
      ) : (
        <div className="space-y-1">
          {list.map((consent) => {
            const withdrawn = consent.withdrawnAt != null;
            return (
              <div
                key={consent.id}
                className="flex items-center justify-between rounded-lg px-3 py-2.5 -mx-3"
              >
                <div className="min-w-0">
                  <span className="text-sm text-[#333] font-medium block truncate">
                    {consent.consentType}
                  </span>
                  <span className="text-[12px] text-[#8B8B8B]">
                    {e.consentVersion} {consent.textVersion} ·{' '}
                    {withdrawn
                      ? `${e.consentWithdrawnOn} ${formatDate(consent.withdrawnAt)}`
                      : `${e.consentAgreedOn} ${formatDate(consent.agreedAt)}`}
                  </span>
                </div>
                <span
                  className={`text-[12px] font-medium rounded-full px-2.5 py-1 ml-3 shrink-0 ${
                    withdrawn
                      ? 'bg-gray-100 text-gray-600'
                      : 'bg-green-50 text-green-700'
                  }`}
                >
                  {withdrawn ? e.consentWithdrawn : e.consentActive}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
