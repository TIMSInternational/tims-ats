'use client';

import { useState } from 'react';
import { useI18n } from '../../../../../../lib/i18n';
import { isProviderAssessmentsStaffEnabled } from '../../../../../../lib/platform-api/assessment-providers-staff';
import { useProviderBindingState } from '../../../../../../lib/platform-api/assessment-provider-admin';
import { Button, ErrorState, Skeleton } from '../../../../../../components';
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
    return <p className="text-body text-secondary">{pa.notEnabled}</p>;
  }

  const card = 'space-y-3 rounded-xl bg-white p-4 shadow-card md:p-5';
  const body = () => {
    if (state.isLoading) {
      return (
        <div aria-busy="true" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <span className="sr-only">{pa.loading}</span>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} aria-hidden="true">
              <Skeleton className="mb-1 h-3 w-24" />
              <Skeleton className="h-4 w-40" />
            </div>
          ))}
        </div>
      );
    }
    if (state.isError || !state.data) {
      return <ErrorState size="compact" title={pa.loadError} error={state.error} onRetry={() => state.refetch()} />;
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
        <dl className="grid grid-cols-1 gap-2 text-callout sm:grid-cols-2" data-testid="provider-binding-state">
          <div>
            <dt className="font-medium text-secondary">{pa.stateTitle}</dt>
            <dd className="font-semibold text-brand">{label}</dd>
          </div>
          <div>
            <dt className="font-medium text-secondary">{pa.tenantLabel}</dt>
            <dd className="break-all font-mono text-primary">{s.providerTenantId ?? pa.none}</dd>
          </div>
          <div>
            <dt className="font-medium text-secondary">{pa.instrumentsLabel}</dt>
            <dd className="text-primary">
              {s.enabledInstruments.length > 0
                ? s.enabledInstruments.map((instrument) => pa.instrument[instrument]).join(', ')
                : pa.none}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-secondary">{pa.updatedLabel}</dt>
            <dd className="text-primary">{updated ?? pa.none}</dd>
          </div>
        </dl>
        <AssessmentProviderOpenWork work={s.openWork} />
        <AssessmentProviderBindingForm
          key={`${s.active}-${s.updatedAt ?? ''}`}
          organizationId={organizationId}
          state={s}
        />
        {s.active && (
          <div className="space-y-2 border-t border-border pt-3">
            <h4 className="text-body font-semibold text-primary">{pa.unbindTitle}</h4>
            <p className="text-callout text-secondary">{pa.unbindHelp}</p>
            <Button variant="destructive-secondary" onClick={() => setUnbinding(true)}>
              {pa.unbindButton}
            </Button>
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
        <h2 id="provider-admin-title" className="text-subheading font-semibold text-primary">
          {pa.title}
        </h2>
        <p className="text-callout text-secondary">{pa.intro}</p>
        {body()}
      </section>
      <div className={card}>
        <AssessmentProviderDsarPanel organizationId={organizationId} />
      </div>
    </div>
  );
}
