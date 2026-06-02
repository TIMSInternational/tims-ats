'use client';

import { useI18n } from '../../../lib/i18n';

interface PendingTest {
  name: string;
  type: string;
  daysAgo: number;
}

interface PendingScorecard {
  name: string;
  interviewType: string;
  evaluator: string;
}

const PENDING_TESTS: PendingTest[] = [
  { name: 'Maria Lopez', type: 'PCA', daysAgo: 5 },
  { name: 'Juan Perez', type: 'Integridad', daysAgo: 3 },
  { name: 'Ana Torres', type: 'MIL', daysAgo: 7 },
];

const PENDING_SCORECARDS: PendingScorecard[] = [
  { name: 'Carlos Ruiz', interviewType: 'Entrevista tecnica', evaluator: 'Laura G.' },
  { name: 'Sofia Chen', interviewType: 'Entrevista cultural', evaluator: 'Andres T.' },
];

export function AlertsPendingPanel() {
  const { t } = useI18n();
  const rd = t.recruitingDashboard;
  const totalPending = PENDING_TESTS.length + 5 + PENDING_SCORECARDS.length + 2;

  return (
    <div className="flex-1 bg-white rounded-xl p-4 shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
      <div className="flex justify-between items-center mb-4">
        <span className="text-sm font-semibold text-[#1F114C]">{rd.pendingTests}</span>
        <span className="bg-amber-500 text-white text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center">
          {totalPending}
        </span>
      </div>

      {/* Pending Tests */}
      <p className="text-xs text-[#585858] mb-2">
        {rd.pendingTestsLabel} ({PENDING_TESTS.length + 5})
      </p>
      <div className="space-y-2 mb-3">
        {PENDING_TESTS.map((test) => (
          <div key={test.name} className="flex justify-between items-center h-10">
            <div>
              <p className="text-[13px] text-[#333]">
                {test.name} — {test.type}
              </p>
              <p className="text-[11px] text-[#8B8B8B]">
                {rd.assignedAgo} {test.daysAgo} {rd.days}
              </p>
            </div>
            <button className="text-xs text-[#DD0C15] hover:underline">{rd.resend}</button>
          </div>
        ))}
        <span className="text-xs text-[#DD0C15]">+5 {rd.more}</span>
      </div>

      {/* Pending Scorecards */}
      <div className="border-t border-[#EDEDED] pt-3">
        <p className="text-xs text-[#585858] mb-2">
          {rd.pendingScorecards} ({PENDING_SCORECARDS.length + 2})
        </p>
        <div className="space-y-2">
          {PENDING_SCORECARDS.map((sc) => (
            <div key={sc.name} className="flex justify-between items-center h-10">
              <div>
                <p className="text-[13px] text-[#333]">
                  {sc.name} — {sc.interviewType}
                </p>
                <p className="text-[11px] text-[#8B8B8B]">
                  {rd.evaluator}: {sc.evaluator}
                </p>
              </div>
              <button className="text-xs text-[#1F114C] hover:underline">{rd.remind}</button>
            </div>
          ))}
          <span className="text-xs text-[#DD0C15]">+2 {rd.more}</span>
        </div>
      </div>
    </div>
  );
}
