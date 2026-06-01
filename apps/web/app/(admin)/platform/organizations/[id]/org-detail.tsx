'use client';

import { useState } from 'react';
import Link from 'next/link';
import { trpc } from '../../../../../lib/trpc';
import { toast } from '../../../../../lib/toast';
import { useI18n } from '../../../../../lib/i18n';
import { getInitials, getAvatarColor, planBadge, statusDot, Skeleton } from '../org-utils';
import { EditOrgModal } from '../edit-org-modal';
import { OverviewSection } from './sections/overview-section';
import { UsersSection } from './sections/users-section';
import { BillingSection } from './sections/billing-section';
import { FeaturesSection } from './sections/features-section';
import { AiSection } from './sections/ai-section';
import { ActivitySection } from './sections/activity-section';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'users', label: 'Users' },
  { key: 'billing', label: 'Billing' },
  { key: 'features', label: 'Features' },
  { key: 'ai', label: 'AI' },
  { key: 'activity', label: 'Activity' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export function OrgDetail({ id }: { id: string }) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [showEdit, setShowEdit] = useState(false);

  const utils = trpc.useUtils();
  const { data: org, isLoading, error } = trpc.platform.getOrganization.useQuery({ id });

  const suspendOrg = trpc.platform.suspendOrganization.useMutation({
    onSuccess: () => {
      utils.platform.getOrganization.invalidate({ id });
      toast('Estado de organizacion actualizado', { type: 'success' });
    },
    onError: (err) => {
      toast(err.message || 'Error al cambiar estado', { type: 'error' });
    },
  });

  const handleSuspendToggle = () => {
    if (!org) return;
    const willSuspend = org.isActive;
    if (willSuspend && !confirm(`Suspender ${org.name}?`)) return;
    suspendOrg.mutate({ id: org.id, suspend: willSuspend });
  };

  if (isLoading) {
    return (
      <div className="h-full flex flex-col overflow-hidden p-6 animate-pulse">
        <Skeleton className="h-4 w-40 mb-6" />
        <div className="flex items-center gap-4 mb-6">
          <div className="w-12 h-12 rounded-xl bg-gray-200" />
          <div>
            <Skeleton className="h-6 w-48 mb-2" />
            <Skeleton className="h-3 w-28" />
          </div>
        </div>
        <div className="flex gap-6 mb-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-16" />
          ))}
        </div>
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] flex-1 p-6">
          <Skeleton className="h-5 w-32 mb-4" />
          <div className="grid grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !org) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6">
        <svg className="w-12 h-12 text-[#EDEDED] mb-3" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
          <path d="M3 21h18M3 7v14m6-14v14m6-14v14m6-14v14M3 7l9-4 9 4" />
        </svg>
        <p className="text-sm text-[#8B8B8B] mb-1">Organizacion no encontrada</p>
        <Link href="/platform/organizations" className="text-sm text-[#1F114C] hover:underline font-medium mt-2">
          {t.common.back} a {t.organizations.title}
        </Link>
      </div>
    );
  }

  const plan = org.plan || org.subscription?.plan || 'trial';

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      {/* Back link */}
      <Link href="/platform/organizations" className="flex items-center gap-1.5 text-sm text-[#8B8B8B] hover:text-[#585858] transition mb-4 w-fit">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 19l-7-7 7-7" /></svg>
        {t.common.back} a {t.organizations.title}
      </Link>

      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <div className={`w-12 h-12 rounded-xl ${getAvatarColor(org.name)} flex items-center justify-center text-white text-sm font-bold flex-shrink-0`}>
          {getInitials(org.name)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-[#333] truncate">{org.name}</h1>
            {planBadge(plan)}
            {statusDot(org.subscription?.status ?? '', org.isActive, { active: t.organizations.statusActive, suspended: t.organizations.statusSuspended })}
          </div>
          <p className="text-xs text-[#8B8B8B] font-mono mt-0.5">{org.slug}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setShowEdit(true)}
            className="h-9 px-4 rounded-lg border border-[#EDEDED] text-sm text-[#585858] font-medium hover:bg-[#F6F6F6] transition flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
            {t.common.edit}
          </button>
          <button
            onClick={handleSuspendToggle}
            disabled={suspendOrg.isPending}
            className={`h-9 px-4 rounded-lg text-sm font-medium transition flex items-center gap-1.5 disabled:opacity-50 ${
              org.isActive
                ? 'border border-red-200 text-[#DD0C15] hover:bg-red-50'
                : 'border border-green-200 text-green-700 hover:bg-green-50'
            }`}
          >
            {org.isActive ? t.organizations.suspend : t.organizations.activate}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-[#EDEDED] mb-6">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors relative ${
              activeTab === tab.key
                ? 'text-[#1F114C]'
                : 'text-[#8B8B8B] hover:text-[#585858]'
            }`}
          >
            {tab.label}
            {activeTab === tab.key && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#1F114C] rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {activeTab === 'overview' && <OverviewSection org={org} />}
        {activeTab === 'users' && <UsersSection organizationId={id} />}
        {activeTab === 'billing' && <BillingSection organizationId={id} />}
        {activeTab === 'features' && <FeaturesSection organizationId={id} />}
        {activeTab === 'ai' && <AiSection organizationId={id} />}
        {activeTab === 'activity' && <ActivitySection organizationId={id} />}
      </div>

      {/* Edit modal */}
      {showEdit && (
        <EditOrgModal
          org={org as any}
          onClose={() => setShowEdit(false)}
          onSuccess={() => {
            setShowEdit(false);
            utils.platform.getOrganization.invalidate({ id });
          }}
        />
      )}
    </div>
  );
}
