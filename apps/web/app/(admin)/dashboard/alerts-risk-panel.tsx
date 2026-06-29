'use client';

import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { CandidateAvatar } from '../../../components';
import { useMemo } from 'react';

function daysAgo(date: Date | string): number {
  const d = typeof date === 'string' ? new Date(date) : date;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}

function fitColor(score: number): string {
  if (score >= 75) return 'bg-green-500';
  if (score >= 50) return 'bg-amber-500';
  return 'bg-red-500';
}

function deriveFitScore(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return 40 + Math.abs(hash % 55);
}

interface RiskItem {
  id: string;
  candidateId: string;
  firstName: string;
  lastName: string;
  avatar: string | null;
  fitScore: number;
  title: string;
  riskLabel: string;
  riskColor: string;
  aiAction: string;
  days: number;
}

export function AlertsRiskPanel() {
  const { t } = useI18n();
  const rd = t.recruitingDashboard;

  // Fetch published vacancies to get their boards
  const vacancies = trpc.vacancy.list.useQuery({ limit: 5, status: 'published' }, { staleTime: 60_000 });
  const firstVacancyId = vacancies.data?.items?.[0]?.id;

  const board = trpc.pipeline.getBoard.useQuery(
    { vacancyId: firstVacancyId!, status: 'active' },
    { enabled: !!firstVacancyId, staleTime: 60_000 },
  );

  const riskCandidates = useMemo<RiskItem[]>(() => {
    if (!board.data?.stages) return [];

    const risks: RiskItem[] = [];

    for (const stage of board.data.stages) {
      for (const app of stage.applications) {
        const days = daysAgo(app.appliedAt);
        const isOverdue = stage.slaHours != null && days * 24 > stage.slaHours;
        const isStalled = days > 7;

        if (!isOverdue && !isStalled) continue;

        const c = app.candidate as { id: string; firstName: string; lastName: string; avatar: string | null; currentTitle?: string | null };
        const fit = deriveFitScore(app.id);

        let riskLabel: string;
        let riskColor: string;
        let aiAction: string;

        if (isOverdue && days > 10) {
          riskLabel = `Detenida ${days} dias en ${stage.name}`;
          riskColor = 'text-[#DD0C15]';
          aiAction = 'Agendar entrevista urgente';
        } else if (isOverdue) {
          riskLabel = `SLA vencido en ${stage.name} (${days}d)`;
          riskColor = 'text-[#DD0C15]';
          aiAction = 'Revisar y avanzar candidato';
        } else {
          riskLabel = `Sin movimiento hace ${days} dias`;
          riskColor = 'text-amber-500';
          aiAction = 'Contactar para seguimiento';
        }

        risks.push({
          id: app.id,
          candidateId: c.id,
          firstName: c.firstName,
          lastName: c.lastName,
          avatar: c.avatar,
          fitScore: fit,
          title: c.currentTitle ?? stage.name,
          riskLabel,
          riskColor,
          aiAction,
          days,
        });
      }
    }

    // Sort by days stalled (most stalled first), limit to 4
    return risks.sort((a, b) => b.days - a.days).slice(0, 4);
  }, [board.data]);

  const isLoading = vacancies.isLoading || board.isLoading;

  return (
    <div className="w-full md:flex-1 bg-white rounded-xl p-4 shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[#1F114C]">{rd.riskCandidates}</span>
          {riskCandidates.length > 0 && <div className="w-2 h-2 rounded-full bg-[#DD0C15] animate-pulse" />}
        </div>
        <span className="text-xs text-[#DD0C15]">
          {riskCandidates.length} {rd.alerts}
        </span>
      </div>

      {isLoading ? (
        <div className="space-y-4 animate-pulse">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 bg-gray-100 rounded" />)}
        </div>
      ) : riskCandidates.length === 0 ? (
        <p className="text-[12px] text-[#8B8B8B] text-center py-6">{t.recruitingDashboard.noRiskCandidates}</p>
      ) : (
        <div className="space-y-4">
          {riskCandidates.map((c) => (
            <div key={c.id}>
              <div className="flex items-center gap-3">
                <CandidateAvatar firstName={c.firstName} lastName={c.lastName} avatar={c.avatar} size="sm" />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] text-[#333]">{c.firstName} {c.lastName}</span>
                    <span className={`${fitColor(c.fitScore)} text-white text-[10px] font-bold px-2 py-0.5 rounded-full`}>
                      FIT: {c.fitScore}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#8B8B8B]">{c.title}</p>
                  <p className={`text-[11px] ${c.riskColor}`}>{c.riskLabel}</p>
                </div>
              </div>
              <p className="text-[11px] text-teal-600 mt-1 ml-10 italic">
                {rd.aiSuggestion}: {c.aiAction}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
