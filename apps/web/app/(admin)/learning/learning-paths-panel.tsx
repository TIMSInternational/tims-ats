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
  error?: unknown;
  onRetry?: () => void;
  /** No courses exist yet: say that a path needs one (why "Crear ruta" is disabled). */
  showNeedsCourseHint?: boolean;
  t: {
    learningPaths: string;
    noPaths: string;
    noPathsHint: string;
    courses: string;
  };
}

const CARD = 'rounded-xl border border-border bg-white p-4 shadow-card md:p-5';

export function LearningPathsPanel({
  paths,
  loading,
  isError,
  error,
  onRetry,
  showNeedsCourseHint,
  t,
}: LearningPathsPanelProps) {
  if (loading) {
    return (
      <div className={CARD} aria-busy="true">
        <Skeleton className="mb-3 h-4 w-48" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  return (
    <section className={CARD} aria-labelledby="learning-paths-heading">
      <h2 id="learning-paths-heading" className="mb-3 text-subheading font-semibold text-primary">
        {t.learningPaths}
      </h2>
      {isError ? (
        <ErrorState size="compact" error={error} onRetry={onRetry} />
      ) : paths.length === 0 ? (
        <div className="py-2 text-center">
          <p className="text-body font-medium text-primary">{t.noPaths}</p>
          {showNeedsCourseHint && <p className="mt-1 text-callout text-secondary">{t.noPathsHint}</p>}
        </div>
      ) : (
        <ul className="space-y-2.5">
          {paths.map((path) => (
            <li key={path.id} className="rounded-lg border border-border p-3">
              <p className="text-body font-medium text-primary">{path.name}</p>
              <p className="text-callout text-secondary">
                {path.courses.length} {t.courses}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
