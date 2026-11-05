'use client';

import { useI18n } from '../../../lib/i18n';
import { EmployeeGrowthSection } from './employee-growth-section';
import { EmployeeSurveys } from './employee-surveys';
import { EmployeeCompensation } from './employee-compensation';
import { EmployeePrivacy } from './employee-privacy';
import { EmployeeRecognition } from './employee-recognition';
import { EmployeeCommitments } from './employee-commitments';
import { EmployeeOnboardingCard } from './employee-onboarding-card';

// employee is OWN-scoped: every query below (and in each section component) is
// auto-narrowed to the caller by scopeWhereFor (we pass NO userId — that would
// widen, not narrow). No *.getDashboardKpis org-rollups (they throw FORBIDDEN at
// own scope) and no suppressedValue (own operational data is not a k-anon aggregate).
//
// Pilot launch scope: only "My Onboarding" is in scope. Every other section owns
// its queries and is simply not mounted, so no performance / learning /
// engagement / compensation / recognition request runs.

interface EmployeeHomeDashboardProps {
  isPilot?: boolean;
}

export function EmployeeHomeDashboard({ isPilot = false }: EmployeeHomeDashboardProps) {
  const { t } = useI18n();
  const e = t.employeeHome;

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-lg font-bold text-[#1F114C]">{e.title}</h1>
          <span className="text-[13px] text-[#585858]">{e.subtitle}</span>
        </div>

        {/* ── SECTIONS 1–2 — My Performance + My Learning ── */}
        {!isPilot && <EmployeeGrowthSection />}

        {/* ── SECTION 3 — My Onboarding ── */}
        <h2 className="text-sm font-semibold text-[#1F114C] mb-3">{e.onboarding}</h2>
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
          {/* onboarding.list (mine: true) is the card's only query; an empty list = no plan. */}
          <EmployeeOnboardingCard />
        </div>

        {!isPilot && (
          <>
            {/* ── SECTION 4 — Mis Encuestas (own-scoped pending surveys) ── */}
            <div className="mt-8">
              <EmployeeSurveys />
            </div>

            {/* ── SECTION 5 — Mi Compensacion (own-scoped, sensitive) ── */}
            <EmployeeCompensation />

            {/* ── SECTION 6 — Privacidad (own-scoped consent ledger) ── */}
            <EmployeePrivacy />

            {/* ── SECTION 7 — Reconocimientos (own-scoped, recognition received) ── */}
            <EmployeeRecognition />

            {/* ── SECTION 8 — Mis Compromisos (own-scoped coaching commitments) ── */}
            <EmployeeCommitments />
          </>
        )}
      </div>
    </div>
  );
}
