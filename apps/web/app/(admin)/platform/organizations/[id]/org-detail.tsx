'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { trpc } from '../../../../../lib/trpc';
import { toast } from '../../../../../lib/toast';
import { useI18n } from '../../../../../lib/i18n';
import { formatMessage } from '../../../../../lib/i18n/format';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  StatusBadge,
  TabPanel,
  Tabs,
} from '../../../../../components';
import { planLabel } from '../plan-label';
import { isPilotScope } from '../../../../../lib/launch-scope';
import { orgLocaleFormFromOrg } from '../../../../../lib/org-locale-form';

import { EditOrgModal } from '../edit-org-modal';
import { OverviewSection } from './sections/overview-section';
import { UsersSection } from './sections/users-section';
import { BillingSection } from './sections/billing-section';
import { FeaturesSection } from './sections/features-section';
import { AiSection } from './sections/ai-section';
import { ActivitySection } from './sections/activity-section';
import { EntitlementsSection } from './sections/entitlements-section';
import { AssessmentProviderSection } from './sections/assessment-provider-section';
import { isProviderAssessmentsStaffEnabled } from '../../../../../lib/platform-api/assessment-providers-staff';

const TAB_KEYS = ['overview', 'users', 'billing', 'features', 'ai', 'activity', 'entitlements', 'assessments'] as const;

type TabKey = (typeof TAB_KEYS)[number];

// The "Features" tab toggles per-org feature flags that gate nothing in the pilot build, like the hidden
// /platform/feature-flags page (platform-owner spec-46 / ideal-84), so the pilot does not offer it.
const PILOT_HIDDEN_TABS: readonly TabKey[] = ['features'];

// The TIMS Assessments tab (round 12: bind, state, safe unbind, DSAR) exists only with the provider connector on.
function visibleTabKeys(): readonly TabKey[] {
  const keys = isProviderAssessmentsStaffEnabled() ? TAB_KEYS : TAB_KEYS.filter((key) => key !== 'assessments');
  return isPilotScope() ? keys.filter((key) => !PILOT_HIDDEN_TABS.includes(key)) : keys;
}

export function OrgDetail({ id }: { id: string }) {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get('tab') as TabKey) || 'overview';
  const tabKeys = visibleTabKeys();
  const TABS: { key: TabKey; label: string }[] = (
    [
      { key: 'overview', label: t.organizations.tabOverview },
      { key: 'users', label: t.organizations.tabUsers },
      { key: 'billing', label: t.organizations.tabBilling },
      { key: 'features', label: t.organizations.tabFeatures },
      { key: 'ai', label: t.organizations.tabAi },
      { key: 'activity', label: t.organizations.tabActivity },
      { key: 'entitlements', label: t.entitlementsAdmin.tabLabel },
      { key: 'assessments', label: t.providerAdmin.tabLabel },
    ] as const
  ).filter((tab) => tabKeys.includes(tab.key));
  const [activeTab, setActiveTab] = useState<TabKey>(tabKeys.includes(initialTab) ? initialTab : 'overview');
  const [showEdit, setShowEdit] = useState(false);
  const [showSuspendConfirm, setShowSuspendConfirm] = useState(false);

  const utils = trpc.useUtils();
  const { data: org, isLoading, error, refetch } = trpc.platform.getOrganization.useQuery({ id });

  const suspendOrg = trpc.platform.suspendOrganization.useMutation({
    onSuccess: () => {
      utils.platform.getOrganization.invalidate({ id });
      toast(t.organizations.statusUpdated, { type: 'success' });
    },
    onError: (err) => {
      toast(err.message || t.organizations.statusChangeError, { type: 'error' });
    },
  });

  const handleSuspendToggle = () => {
    if (!org) return;
    if (org.isActive) {
      setShowSuspendConfirm(true);
    } else {
      suspendOrg.mutate({ id: org.id, suspend: false });
    }
  };

  const o = t.organizations;
  const back = { href: '/platform/organizations', label: o.backToList };

  if (isLoading) {
    return (
      <div className="flex flex-col p-3 md:p-6 lg:h-full lg:overflow-hidden" aria-busy="true">
        <span className="sr-only">{t.common.loadingContent}</span>
        <Skeleton className="mb-4 h-4 w-40" />
        <Skeleton className="mb-2 h-7 w-56" />
        <Skeleton className="mb-6 h-3 w-28" />
        <div className="mb-6 flex gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-16" />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  // A missing organization and a failed load are different situations (feedback.md): only NOT_FOUND says so.
  const notFound = (!error && !org) || error?.data?.code === 'NOT_FOUND';
  if (notFound) {
    return (
      <EmptyState
        className="h-full justify-center"
        title={o.notFound}
        description={t.common.notFoundHint}
        action={{ label: o.backToList, href: back.href, variant: 'secondary' }}
      />
    );
  }
  if (error || !org) {
    return <ErrorState className="h-full" title={o.loadError} error={error} onRetry={() => refetch()} />;
  }

  const plan = org.plan || org.subscription?.plan || 'trial';
  // The primary company (oldest active): the fallback the product uses where settings name no value.
  const primaryCompany = org.companies
    .filter((company) => company.isActive)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())[0];

  return (
    <div className="flex flex-col lg:h-full lg:overflow-hidden">
      <PageHeader
        back={back}
        title={org.name}
        meta={
          <>
            <StatusBadge tone="brand" icon="none">
              {planLabel(plan, t)}
            </StatusBadge>
            <StatusBadge tone={org.isActive ? 'success' : 'danger'}>
              {org.isActive ? o.statusActive : o.statusSuspended}
            </StatusBadge>
          </>
        }
        description={<span className="font-mono">{org.slug}</span>}
        actions={
          <>
            <Button variant="secondary" onClick={() => setShowEdit(true)}>
              {o.editEllipsis}
            </Button>
            {org.isActive ? (
              <Button variant="destructive-secondary" onClick={handleSuspendToggle} disabled={suspendOrg.isPending}>
                {o.suspendEllipsis}
              </Button>
            ) : (
              <Button variant="secondary" onClick={handleSuspendToggle} loading={suspendOrg.isPending}>
                {o.reactivateOrg}
              </Button>
            )}
          </>
        }
      >
        <Tabs
          label={o.detailTabsLabel}
          idPrefix="org-detail"
          tabs={TABS.map((tab) => ({ id: tab.key, label: tab.label }))}
          selectedId={activeTab}
          onSelect={(tabKey) => setActiveTab(tabKey as TabKey)}
          className="-mx-4 border-b-0 px-4 md:-mx-6 md:px-6"
        />
      </PageHeader>

      {/* Tab content */}
      <TabPanel idPrefix="org-detail" tabId={activeTab} className="min-h-0 flex-1 p-3 md:p-6 lg:overflow-y-auto">
        {activeTab === 'overview' && <OverviewSection org={org} />}
        {activeTab === 'users' && <UsersSection organizationId={id} organizationName={org.name} />}
        {activeTab === 'billing' && <BillingSection organizationId={id} />}
        {activeTab === 'features' && tabKeys.includes('features') && <FeaturesSection organizationId={id} />}
        {activeTab === 'ai' && <AiSection organizationId={id} />}
        {activeTab === 'activity' && <ActivitySection organizationId={id} />}
        {activeTab === 'entitlements' && <EntitlementsSection orgId={id} />}
        {activeTab === 'assessments' && tabKeys.includes('assessments') && (
          <AssessmentProviderSection organizationId={id} organizationName={org.name} />
        )}
      </TabPanel>

      {/* Edit modal */}
      {showEdit && (
        <EditOrgModal
          org={org}
          localeInitial={orgLocaleFormFromOrg(org.settings, primaryCompany)}
          onClose={() => setShowEdit(false)}
          onSuccess={() => {
            setShowEdit(false);
            utils.platform.getOrganization.invalidate({ id });
          }}
        />
      )}

      {/* Suspend confirmation */}
      {showSuspendConfirm && (
        <ConfirmDialog
          title={formatMessage(o.confirmSuspendTitle, { name: org.name })}
          description={o.confirmSuspendBody}
          confirmLabel={o.suspendOrg}
          destructive
          onConfirm={() => {
            setShowSuspendConfirm(false);
            suspendOrg.mutate({ id: org.id, suspend: true });
          }}
          onCancel={() => setShowSuspendConfirm(false)}
        />
      )}
    </div>
  );
}
