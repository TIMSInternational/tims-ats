'use client';

import { Skeleton, ErrorState } from '../../../components';

interface LearningPath {
  id: string;
  name: string;
  courses: { id: string }[];
}

interface LearningPathsPanelProps {
  paths: LearningPath[];
  loading: boolean;
  isError?: boolean;
  onRetry?: () => void;
  t: {
    learningPaths: string;
    noPaths: string;
    courses: string;
  };
}

export function LearningPathsPanel({ paths, loading, isError, onRetry, t }: LearningPathsPanelProps) {
  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
        <Skeleton className="h-4 w-48 mb-3" />
        <Skeleton className="h-10 w-full" />
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

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
      <h3 className="text-[13px] font-semibold text-[#1F114C] mb-3">{t.learningPaths}</h3>
      {paths.length === 0 ? (
        <p className="text-[12px] text-[#8B8B8B]">{t.noPaths}</p>
      ) : (
        <div className="space-y-2.5">
          {paths.map((path) => (
            <div key={path.id} className="border border-[#EDEDED] rounded-lg p-3">
              <p className="text-[12px] font-medium text-[#333]">{path.name}</p>
              <p className="text-[10px] text-[#8B8B8B]">
                {path.courses.length} {t.courses}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
