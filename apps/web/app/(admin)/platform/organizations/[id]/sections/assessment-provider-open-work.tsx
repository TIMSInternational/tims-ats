'use client';

import { useI18n } from '../../../../../../lib/i18n';
import { hasOpenWork, type ProviderOpenWork } from '../../../../../../lib/platform-api/assessment-provider-admin';

const KEYS = ['cancellable', 'awaitingResult', 'pendingWithdrawals', 'cancelPending', 'createsInFlight'] as const;

// The provider work an unbind would strand, one line per kind that is not zero.
export function AssessmentProviderOpenWork({ work }: { work: ProviderOpenWork }) {
  const { t } = useI18n();
  const pa = t.providerAdmin;
  return (
    <div data-testid="provider-open-work">
      <h5 className="text-[12px] font-semibold text-[#1F114C]">{pa.openWorkTitle}</h5>
      {hasOpenWork(work) ? (
        <ul className="list-disc pl-5 text-[12px]">
          {KEYS.filter((key) => work[key] > 0).map((key) => (
            <li key={key}>{pa.openWork[key].replace('{n}', String(work[key]))}</li>
          ))}
        </ul>
      ) : (
        <p className="text-[12px]">{pa.noOpenWork}</p>
      )}
    </div>
  );
}
