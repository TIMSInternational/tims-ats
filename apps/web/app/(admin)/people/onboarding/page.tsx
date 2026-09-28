'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { KpiCard, KpiCardSkeleton, ErrorState } from '../../../../components';
import { OnboardingTable, type OnboardingPlan } from './onboarding-table';
import { CreatePlanModal } from './create-plan-modal';
import { CompleteCheckInModal } from './complete-check-in-modal';
import { TasksByResponsible, PendingTasks } from './onboarding-panels';

/* ── KPI Icons ─────────────────────────────────────────────── */

function IconActive() {
  return (
    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
      <path d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.58-5.84a14.927 14.927 0 00-2.58 5.84" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
      <path d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function IconDoc() {
  return (
    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
      <path d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  );
}

function IconRisk() {
  return (
    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
      <path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
    </svg>
  );
}

function IconClock() {
  return (
    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
      <path d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}

/* ── Page ───────────────────────────────────────────────────── */

export default function OnboardingPage() {
  const { t } = useI18n();
  const [phase, setPhase] = useState<string | undefined>(undefined);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedCheckIn, setSelectedCheckIn] = useState<{ id: string; label: string } | null>(null);

  const kpis = trpc.onboarding.getDashboardKpis.useQuery();
  const plans = trpc.onboarding.list.useQuery({
    limit: 50,
    status: 'active',
    ...(phase ? { phase } : {}),
  });

  const k = kpis.data;
  const items = (plans.data?.plans ?? []) as OnboardingPlan[];
  const atRiskCount = k?.atRiskPlans ?? 0;
  const pendingTasks = k ? k.totalTasks - k.completedTasks : 0;

  const handlePhaseChange = (p: string) => {
    setPhase(p === 'all' ? undefined : p);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-y-2 px-4 md:px-6 min-h-16 py-2 bg-white border-b border-[#EDEDED] shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-[#8B8B8B]">People</span>
          <svg className="w-3 h-3 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="m9 18 6-6-6-6" />
          </svg>
          <span className="text-sm font-medium text-[#1F114C]">{t.onboarding.title} Dashboard</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 bg-[#DD0C15] text-white px-4 h-8 rounded-lg text-[12px] font-medium hover:bg-[#c40b13] transition"
          >
            <PlusIcon />
            {t.onboarding.createPlanTitle}
          </button>
        </div>
      </div>
      {showCreate && <CreatePlanModal onClose={() => setShowCreate(false)} />}
      {selectedCheckIn && <CompleteCheckInModal id={selectedCheckIn.id} label={selectedCheckIn.label} onClose={() => setSelectedCheckIn(null)} />}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* KPI Row */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          {kpis.isLoading ? (
            Array.from({ length: 5 }).map((_, i) => <KpiCardSkeleton key={i} />)
          ) : kpis.isError ? (
            <div className="col-span-2 md:col-span-5">
              <ErrorState onRetry={() => kpis.refetch()} />
            </div>
          ) : (
            <>
              <KpiCard
                label="Onboardings Activos"
                value={k?.activePlans ?? 0}
                icon={<IconActive />}
                iconBg="bg-[#1F114C]"
                valueColor="text-[#1F114C]"
              />
              <KpiCard
                label="Tasa Finalizacion"
                value={`${k?.taskCompletionRate ?? 0}%`}
                subtitle="tareas completadas"
                icon={<IconCheck />}
                iconBg="bg-green-600"
                valueColor="text-green-600"
              />
              <KpiCard
                label="Tareas Pendientes"
                value={pendingTasks}
                subtitle="requieren accion"
                icon={<IconDoc />}
                iconBg="bg-amber-500"
                valueColor="text-amber-500"
                highlight={pendingTasks > 0}
              />
              <KpiCard
                label="Riesgo Onboarding"
                value={atRiskCount}
                subtitle="personas en riesgo"
                icon={<IconRisk />}
                iconBg="bg-[#DD0C15]"
                valueColor="text-[#DD0C15]"
                highlight={atRiskCount > 0}
              />
              <KpiCard
                label="Check-ins Vencidos"
                value={k?.overdueCheckIns ?? 0}
                subtitle={t.onboarding.overdueCheckInDesc}
                icon={<IconClock />}
                iconBg="bg-[#1F114C]"
                valueColor="text-[#1F114C]"
              />
            </>
          )}
        </div>

        {/* Active Onboardings Table */}
        {plans.isError ? (
          <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] mb-6">
            <ErrorState onRetry={() => plans.refetch()} />
          </div>
        ) : (
          <OnboardingTable plans={items} isLoading={plans.isLoading} onPhaseChange={handlePhaseChange} />
        )}

        {/* Row 2: Tasks + Docs + Courses */}
        <div className="flex flex-col md:flex-row gap-4 mb-6">
          {plans.isError ? (
            <div className="w-full md:flex-1 bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
              <ErrorState onRetry={() => plans.refetch()} />
            </div>
          ) : (
            <>
              <TasksByResponsible plans={items} />
              <PendingTasks plans={items} />
            </>
          )}
        </div>

        {/* Only persisted check-ins are shown; elapsed days are not proof of completion. */}
        <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <h3 className="text-[14px] font-semibold text-[#1F114C] mb-3">{t.onboarding.checkinCalendar}</h3>
          {plans.isError ? (
            <ErrorState onRetry={() => plans.refetch()} />
          ) : plans.isLoading ? (
            <KpiCardSkeleton />
          ) : items.flatMap((plan) => plan.checkIns).length === 0 ? (
            <p className="text-[12px] text-[#8B8B8B]">{t.onboarding.noCheckinData}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-[#EDEDED]">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="bg-[#FAFAFA]">
                    <th className="py-2 px-3 text-left">Colaborador</th>
                    <th className="py-2 px-3 text-left">Check-in</th>
                    <th className="py-2 px-3 text-left">{t.onboarding.scheduledDate}</th>
                    <th className="py-2 px-3 text-left">Estado</th>
                    <th className="py-2 px-3 text-left">{t.onboarding.checkInAction}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.flatMap((plan) =>
                    plan.checkIns.map((checkIn) => (
                      <tr key={checkIn.id} className="border-t border-[#F0F0F0]">
                        <td className="py-2 px-3">
                          {plan.user.firstName} {plan.user.lastName}
                        </td>
                        <td className="py-2 px-3">{checkIn.type}</td>
                        <td className="py-2 px-3">{new Date(checkIn.scheduledDate).toLocaleDateString('es')}</td>
                        <td className="py-2 px-3">{checkIn.status}</td>
                        <td className="py-2 px-3">
                          {checkIn.status === 'pending' && (
                            <button type="button" onClick={() => setSelectedCheckIn({ id: checkIn.id, label: `${plan.user.firstName} ${plan.user.lastName} — ${checkIn.type}` })} className="font-medium text-[#1F114C] underline">
                              {t.onboarding.completeCheckInTitle}
                            </button>
                          )}
                        </td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
