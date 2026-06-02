'use client';

import { useI18n } from '../../../../../lib/i18n';
import { formatDate } from '../../../../../lib/format-utils';

interface Application {
  id: string;
  status: string;
  source: string;
  appliedAt: Date | string;
  vacancy: { id: string; title: string; status: string };
  currentStage: { id: string; name: string; order: number };
}

interface StageStep {
  name: string;
  date: string | null;
  isCurrent: boolean;
  isCompleted: boolean;
}

function buildStageSteps(app: Application): StageStep[] {
  const currentOrder = app.currentStage.order;
  // Build typical pipeline stages in order
  const stages = [
    { name: 'Postulada', order: 0 },
    { name: 'Preseleccion', order: 1 },
    { name: 'Evaluaciones', order: 2 },
    { name: app.currentStage.name, order: currentOrder },
    { name: 'Oferta', order: currentOrder + 1 },
    { name: 'Contratacion', order: currentOrder + 2 },
  ];

  // Deduplicate by name
  const seen = new Set<string>();
  const unique: typeof stages = [];
  for (const s of stages) {
    if (!seen.has(s.name)) {
      seen.add(s.name);
      unique.push(s);
    }
  }

  return unique.map((s) => ({
    name: s.name,
    date: s.order === 0 ? formatDate(app.appliedAt) : null,
    isCurrent: s.order === currentOrder,
    isCompleted: s.order < currentOrder,
  }));
}

export function StageTimeline({ applications }: { applications: Application[] }) {
  const { t } = useI18n();
  const activeApp = applications.find((a) => a.status === 'active') ?? applications[0];

  if (!activeApp) return null;

  const steps = buildStageSteps(activeApp);
  const appliedDate = new Date(activeApp.appliedAt);
  const totalDays = Math.max(1, Math.ceil((Date.now() - appliedDate.getTime()) / (1000 * 60 * 60 * 24)));

  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h3 className="text-[14px] font-semibold text-[#1F114C] mb-4">{t.candidates.processTimeline}</h3>
      <div className="space-y-0">
        {steps.map((step, i) => {
          const dotColor = step.isCompleted
            ? 'bg-green-500'
            : step.isCurrent
              ? 'bg-[#7B6BAA] ring-2 ring-[#7B6BAA]/30'
              : 'bg-[#EDEDED]';
          const textColor = step.isCompleted || step.isCurrent ? 'text-[#333]' : 'text-[#8B8B8B]';
          const isLast = i === steps.length - 1;

          return (
            <div key={i} className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className={`w-3 h-3 rounded-full ${dotColor} mt-1 shrink-0`} />
                {!isLast && <div className="w-0.5 h-8 bg-[#EDEDED]" />}
              </div>
              <div className="pb-1">
                <p className={`text-[12px] font-medium ${step.isCurrent ? 'text-[#7B6BAA]' : textColor}`}>
                  {step.name}
                  {step.isCurrent && ' (actual)'}
                </p>
                {step.date && (
                  <p className="text-[11px] text-[#8B8B8B]">{step.date} — via {activeApp.source}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-[#585858] mt-3 border-t border-[#F0F0F0] pt-3">
        {t.candidates.totalTimeInProcess}{' '}
        <span className="font-medium text-[#1F114C]">{totalDays} {t.candidates.days}</span>
      </p>
    </div>
  );
}
