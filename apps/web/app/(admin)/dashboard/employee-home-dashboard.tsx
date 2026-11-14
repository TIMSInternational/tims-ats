'use client';

import { useI18n } from '../../../lib/i18n';
import { EmployeeGrowthSection } from './employee-growth-section';
import { EmployeeSurveys } from './employee-surveys';
import { EmployeeCompensation } from './employee-compensation';
import { EmployeePrivacy } from './employee-privacy';
import { EmployeeRecognition } from './employee-recognition';
import { EmployeeCommitments } from './employee-commitments';
import { EmployeeOnboardingCard } from './employee-onboarding-card';
import { DashboardPage } from './dashboard-page';

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

  // Ordered by what needs action (layout.md › Visual hierarchy): onboarding and pending surveys first,
  // then goals and commitments, then the reference sections. Every section is a card on one even rhythm.
  return (
    <DashboardPage title={e.title} description={e.subtitle}>
      <div className="space-y-8">
        {/* ── My Onboarding ── */}
        <section>
          <h2 className="mb-3 text-heading font-semibold text-brand">{e.onboarding}</h2>
          <div className="rounded-xl bg-white p-5 shadow-card">
            {/* onboarding.list (mine: true) is the card's only query; an empty list = no plan. */}
            <EmployeeOnboardingCard />
          </div>
        </section>

        {!isPilot && (
          <>
            {/* ── Mis Encuestas (own-scoped pending surveys) ── */}
            <EmployeeSurveys />

            {/* ── My Performance + My Learning ── */}
            <EmployeeGrowthSection />

            {/* ── Mis Compromisos (own-scoped coaching commitments) ── */}
            <EmployeeCommitments />

            {/* ── Reconocimientos (own-scoped, recognition received) ── */}
            <EmployeeRecognition />

            {/* ── Privacidad (own-scoped consent ledger) ── */}
            <EmployeePrivacy />

            {/* ── Mi Compensación (own-scoped, sensitive) ── */}
            <EmployeeCompensation />
          </>
        )}
      </div>
    </DashboardPage>
  );
}
