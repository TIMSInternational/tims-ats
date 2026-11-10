'use client';

import { useState } from 'react';
import { useI18n } from '../../../../../../lib/i18n';
import { isProviderAssessmentsStaffEnabled } from '../../../../../../lib/platform-api/assessment-providers-staff';
import { useProviderBindingState } from '../../../../../../lib/platform-api/assessment-provider-admin';
import { AssessmentProviderBindingForm } from './assessment-provider-binding-form';
import { AssessmentProviderDsarPanel } from './assessment-provider-dsar-panel';
import { AssessmentProviderOpenWork } from './assessment-provider-open-work';
import { AssessmentProviderUnbindDialog } from './assessment-provider-unbind-dialog';

// Round 12: the platform owner's TIMS Assessments tools for one organization (the runbook found none). The binding's
// state with the open work an unbind would strand, binding (or updating the enabled tests), a confirmed and safe unbind,
// and the provider DSAR export and erasure for one candidate. Everything goes to C#, platform owner only, and is audited
// there. Rendered inside /platform (the layout already admits platform owners only).
export function AssessmentProviderSection({
  organizationId,
  organizationName,
}: {
  organizationId: string;
  organizationName: string;
}) {
  const { t, locale } = useI18n();
  const pa = t.providerAdmin;
  const state = useProviderBindingState(organizationId);
  const [unbinding, setUnbinding] = useState(false);

  if (!isProviderAssessmentsStaffEnabled()) {
    return <p className="text-[13px] text-[#8B8B8B]">{pa.notEnabled}</p>;
  }

  const card = 'bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)] space-y-3';
  const body = () => {
    if (state.isLoading) return <p className="text-[12px] text-[#8B8B8B]">{pa.loading}</p>;
    if (state.isError || !state.data) {
      return (
        <p role="alert" className="text-[12px] text-[#B42318]">
          {pa.loadError}
        </p>
      );
    }

    const s = state.data;
    const label = !s.bound ? pa.stateUnbound : s.active ? pa.stateActive : pa.stateInactive;
    const updated = s.updatedAt
      ? new Intl.DateTimeFormat(locale === 'EN' ? 'en' : 'es', { dateStyle: 'medium', timeStyle: 'short' }).format(
          new Date(s.updatedAt),
        )
      : null;
    return (
      <>
        <dl className="grid grid-cols-1 gap-2 text-[12px] sm:grid-cols-2" data-testid="provider-binding-state">
          <div>
            <dt className="font-medium text-[#8B8B8B]">{pa.stateTitle}</dt>
            <dd className="text-[#1F114C] font-semibold">{label}</dd>
          </div>
          <div>
            <dt className="font-medium text-[#8B8B8B]">{pa.tenantLabel}</dt>
            <dd className="font-mono text-[#585858]">{s.providerTenantId ?? pa.none}</dd>
          </div>
          <div>
            <dt className="font-medium text-[#8B8B8B]">{pa.instrumentsLabel}</dt>
            <dd className="text-[#585858]">
              {s.enabledInstruments.length > 0
                ? s.enabledInstruments.map((instrument) => pa.instrument[instrument]).join(', ')
                : pa.none}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-[#8B8B8B]">{pa.updatedLabel}</dt>
            <dd className="text-[#585858]">{updated ?? pa.none}</dd>
          </div>
        </dl>
        <AssessmentProviderOpenWork work={s.openWork} />
        <AssessmentProviderBindingForm
          key={`${s.active}-${s.updatedAt ?? ''}`}
          organizationId={organizationId}
          state={s}
        />
        {s.active && (
          <div className="space-y-2 border-t border-[#EDEDED] pt-3">
            <h4 className="text-[13px] font-semibold text-[#1F114C]">{pa.unbindTitle}</h4>
            <p className="text-[12px] text-[#585858]">{pa.unbindHelp}</p>
            <button
              type="button"
              onClick={() => setUnbinding(true)}
              className="h-9 rounded-lg border border-red-200 px-4 text-[12px] font-semibold text-[#DD0C15]"
            >
              {pa.unbindButton}
            </button>
          </div>
        )}
        {unbinding && (
          <AssessmentProviderUnbindDialog
            organizationId={organizationId}
            organizationName={organizationName}
            openWork={s.openWork}
            onClose={() => setUnbinding(false)}
          />
        )}
      </>
    );
  };

  return (
    <div className="space-y-4" data-testid="assessment-provider-section">
      <section aria-labelledby="provider-admin-title" className={card}>
        <h3 id="provider-admin-title" className="text-[14px] font-semibold text-[#1F114C]">
          {pa.title}
        </h3>
        <p className="text-[12px] text-[#585858]">{pa.intro}</p>
        {body()}
      </section>
      <div className={card}>
        <AssessmentProviderDsarPanel organizationId={organizationId} />
      </div>
    </div>
  );
}
