'use client';

import { Skeleton, ErrorState } from '../../../components';

interface LearningPath {
  id: string;
  name: string;
  description?: string | null;
  targetGap?: string | null;
  courses: { id: string }[];
}

interface LearningPathsPanelProps {
  paths: LearningPath[];
  loading: boolean;
  isError?: boolean;
  onRetry?: () => void;
  t: {
    learningPaths: string;
    aiGenerated: string;
    peopleAssigned: string;
    courses: string;
  };
}

/* Static demo data to match design when API has no paths */
const DEMO_PATHS = [
  { name: 'Liderazgo Operacional', assigned: 23, steps: 4, progress: 62, currentStep: 3 },
  { name: 'Competencias Digitales', assigned: 41, steps: 3, progress: 38, currentStep: 2 },
  { name: 'Cumplimiento Normativo', assigned: 56, steps: 5, progress: 94, currentStep: 5 },
];

function StepIndicator({ total, current }: { total: number; current: number }) {
  return (
    <div className="flex items-center gap-1 shrink-0">
      {Array.from({ length: total }).map((_, i) => {
        const step = i + 1;
        const isCompleted = step <= current;
        const isCurrent = step === current;
        const bg = isCompleted
          ? step < current
            ? 'bg-[#1F114C]'
            : isCurrent && current < total
              ? 'bg-amber-500'
              : 'bg-green-500'
          : 'bg-[#EDEDED]';
        const text = isCompleted ? 'text-white' : 'text-[#8B8B8B]';
        const lineBg = step <= current ? (step < current ? 'bg-[#1F114C]' : 'bg-[#1F114C]') : 'bg-[#EDEDED]';

        return (
          <div key={step} className="flex items-center gap-1">
            <div className={`w-5 h-5 rounded-full ${bg} ${text} text-[8px] flex items-center justify-center font-bold`}>
              {step}
            </div>
            {step < total && <div className={`w-4 h-0.5 ${step < current ? 'bg-[#1F114C]' : step === current ? lineBg : 'bg-[#EDEDED]'}`} />}
          </div>
        );
      })}
    </div>
  );
}

export function LearningPathsPanel({ paths, loading, isError, onRetry, t }: LearningPathsPanelProps) {
  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 max-h-[195px]">
        <Skeleton className="h-4 w-48 mb-3" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full mb-2" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <ErrorState onRetry={onRetry} />
      </div>
    );
  }

  const displayPaths = paths.length > 0
    ? paths.map((p) => ({
        name: p.name,
        assigned: 0,
        steps: p.courses.length,
        progress: 0,
        currentStep: 0,
      }))
    : DEMO_PATHS;

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 max-h-[195px]">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold text-[#1F114C]">{t.learningPaths}</h3>
        <span className="text-[10px] text-[#8B8B8B]">{t.aiGenerated}</span>
      </div>
      <div className="space-y-2.5 overflow-y-auto max-h-[130px]">
        {displayPaths.map((path) => {
          const color = path.progress >= 80 ? 'text-green-600' : 'text-amber-600';
          return (
            <div key={path.name} className="flex items-center gap-3">
              <StepIndicator total={path.steps} current={path.currentStep} />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-medium text-[#333] truncate">{path.name}</p>
                <p className="text-[10px] text-[#8B8B8B]">
                  {path.assigned} {t.peopleAssigned} &middot; {path.steps} {t.courses}
                </p>
              </div>
              <span className={`text-[10px] font-medium ${color} shrink-0`}>{path.progress}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
