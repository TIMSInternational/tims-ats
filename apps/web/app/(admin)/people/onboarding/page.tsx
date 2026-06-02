'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { KpiCard, KpiCardSkeleton } from '../../../../components';
import { OnboardingTable, type OnboardingPlan } from './onboarding-table';
import {
  TasksByResponsible,
  PendingDocuments,
  CoursesAndAccesses,
  LearningRoute,
} from './onboarding-panels';

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

function ExportIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
      <path d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
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

  const kpis = trpc.onboarding.getDashboardKpis.useQuery();
  const plans = trpc.onboarding.list.useQuery({
    limit: 50,
    status: 'active',
    ...(phase ? { phase } : {}),
  });

  const k = kpis.data;
  const items = (plans.data?.plans ?? []) as OnboardingPlan[];
  const atRiskCount = items.filter((p) => (p.riskScore ?? 0) > 0.3).length;
  const pendingDocs = k ? k.totalTasks - k.completedTasks : 0;

  const handlePhaseChange = (p: string) => {
    setPhase(p === 'all' ? undefined : p);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 h-16 bg-white border-b border-[#EDEDED] shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-[#8B8B8B]">People</span>
          <svg className="w-3 h-3 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="m9 18 6-6-6-6" />
          </svg>
          <span className="text-sm font-medium text-[#1F114C]">{t.onboarding.title} Dashboard</span>
        </div>
        <div className="flex items-center gap-3">
          <button className="flex items-center gap-1.5 border border-[#EDEDED] text-[#585858] px-3 h-8 rounded-lg text-[12px] hover:bg-[#F6F6F6] transition">
            <ExportIcon />Exportar
          </button>
          <button className="flex items-center gap-1.5 bg-[#DD0C15] text-white px-4 h-8 rounded-lg text-[12px] font-medium hover:bg-[#c40b13] transition">
            <PlusIcon />Nuevo Onboarding
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* KPI Row */}
        <div className="grid grid-cols-5 gap-3 mb-6">
          {kpis.isLoading ? (
            Array.from({ length: 5 }).map((_, i) => <KpiCardSkeleton key={i} />)
          ) : (
            <>
              <KpiCard
                label="Onboardings Activos"
                value={k?.activePlans ?? 0}
                subtitle={`+${k?.activePlans ?? 0} este mes`}
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
                label="Docs Pendientes"
                value={pendingDocs}
                subtitle="requieren accion"
                icon={<IconDoc />}
                iconBg="bg-amber-500"
                valueColor="text-amber-500"
                highlight={pendingDocs > 0}
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
                subtitle="pendientes de agendar"
                icon={<IconClock />}
                iconBg="bg-[#1F114C]"
                valueColor="text-[#1F114C]"
              />
            </>
          )}
        </div>

        {/* Active Onboardings Table */}
        <OnboardingTable
          plans={items}
          isLoading={plans.isLoading}
          onPhaseChange={handlePhaseChange}
        />

        {/* Row 2: Tasks + Docs + Courses */}
        <div className="flex gap-4 mb-6">
          <TasksByResponsible plans={items} />
          <PendingDocuments plans={items} />
          <CoursesAndAccesses />
        </div>

        {/* Row 3: Check-in Calendar + Learning Route */}
        <div className="flex gap-4">
          <div className="flex-1 bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
            <h3 className="text-[14px] font-semibold text-[#1F114C] mb-3">Calendario de Check-ins</h3>
            <div className="overflow-hidden rounded-lg border border-[#EDEDED]">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="bg-[#FAFAFA]">
                    <th className="py-2 px-3 text-left text-[#585858] font-medium">Colaborador</th>
                    <th className="py-2 px-3 text-center text-[#585858] font-medium">Dia 1</th>
                    <th className="py-2 px-3 text-center text-[#585858] font-medium">Sem 1</th>
                    <th className="py-2 px-3 text-center text-[#585858] font-medium">Dia 30</th>
                    <th className="py-2 px-3 text-center text-[#585858] font-medium">Dia 60</th>
                    <th className="py-2 px-3 text-center text-[#585858] font-medium">Dia 90</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 && !plans.isLoading && (
                    <tr><td colSpan={6} className="py-8 text-center text-[12px] text-[#8B8B8B]">Sin datos de check-in</td></tr>
                  )}
                  {items.map((plan, idx) => {
                    const day = Math.max(0, Math.floor((Date.now() - new Date(plan.startDate).getTime()) / 86400000));
                    const start = new Date(plan.startDate);
                    const fmtMilestone = (d: number) => {
                      const dt = new Date(start.getTime() + d * 86400000);
                      return dt.toLocaleDateString('es', { month: 'short', day: 'numeric' });
                    };
                    const risk = (plan.riskScore ?? 0) > 0.3;
                    const completedCount = plan.checkIns.filter((c) => c.status === 'completed').length;
                    return (
                      <tr key={plan.id} className={`border-t border-[#F0F0F0] ${idx % 2 === 1 ? 'bg-[#FAFAFA]' : ''}`}>
                        <td className={`py-2 px-3 font-medium ${risk ? 'text-[#DD0C15]' : 'text-[#333]'}`}>{plan.user.firstName} {plan.user.lastName}</td>
                        <td className="py-2 px-3 text-center">{day >= 1 ? <span className="text-green-600">✓</span> : <span className="text-[#8B8B8B]">{fmtMilestone(1)}</span>}</td>
                        <td className="py-2 px-3 text-center">{day >= 7 && completedCount >= 1 ? <span className="text-green-600">✓</span> : day >= 7 && risk ? <span className="text-[#DD0C15] font-medium">Vencido!</span> : <span className="text-[#8B8B8B]">{fmtMilestone(7)}</span>}</td>
                        <td className="py-2 px-3 text-center">{day >= 30 && completedCount >= 2 ? <span className="text-green-600">✓</span> : day >= 30 && risk ? <span className="text-[#DD0C15] font-medium">Vencido!</span> : day >= 25 ? <span className="text-amber-600 font-medium">{day >= 28 ? 'Pronto' : fmtMilestone(30)}</span> : <span className="text-[#8B8B8B]">{fmtMilestone(30)}</span>}</td>
                        <td className="py-2 px-3 text-center">{day >= 60 && completedCount >= 3 ? <span className="text-green-600">✓</span> : day >= 60 ? <span className="text-amber-600 font-medium">Pendiente</span> : <span className="text-[#8B8B8B]">{fmtMilestone(60)}</span>}</td>
                        <td className="py-2 px-3 text-center"><span className="text-[#8B8B8B]">{fmtMilestone(90)}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <LearningRoute />
        </div>
      </div>
    </div>
  );
}
