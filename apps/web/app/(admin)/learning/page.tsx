'use client';

import { useState } from 'react';
import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { CreateCourseModal } from './create-course-modal';
import { CreatePathModal } from './create-path-modal';
import { LearningKpis } from './learning-kpis';
import { CourseCatalog } from './course-catalog';
import { LearningPathsPanel } from './learning-paths-panel';

export default function LearningPage() {
  const { t } = useI18n();
  const [showCreateCourse, setShowCreateCourse] = useState(false);
  const [showCreatePath, setShowCreatePath] = useState(false);
  const kpis = trpc.learning.getDashboardKpis.useQuery();
  const courses = trpc.learning.listCourses.useQuery({ pageSize: 50 });
  const paths = trpc.learning.listPaths.useQuery();

  const courseItems = courses.data?.courses ?? [];
  const pathItems = paths.data ?? [];

  return (
    <div className="flex flex-col flex-1 min-w-0 h-full">
      {/* Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-y-2 px-4 md:px-6 min-h-16 py-2 bg-white border-b border-[#EDEDED] shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-[#8B8B8B]">{t.learning.breadcrumb}</span>
          <svg className="w-3 h-3 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="m9 18 6-6-6-6" />
          </svg>
          <span className="text-sm font-medium text-[#1F114C]">{t.learning.title}</span>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setShowCreatePath(true)} disabled={courseItems.length === 0} className="rounded-lg border border-[#1F114C] px-4 py-2 text-[12px] font-medium text-[#1F114C] disabled:opacity-50">{t.learning.createPath}</button>
          <button type="button" onClick={() => setShowCreateCourse(true)} className="rounded-lg bg-[#DD0C15] px-4 py-2 text-[12px] font-medium text-white">{t.learning.newCourse}</button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5">
        <LearningKpis
          data={kpis.data}
          loading={kpis.isLoading}
          isError={kpis.isError}
          onRetry={() => kpis.refetch()}
          t={t.learning}
        />

        <div className="flex flex-col md:flex-row gap-4">
          <CourseCatalog
            courses={courseItems}
            loading={courses.isLoading}
            isError={courses.isError}
            onRetry={() => courses.refetch()}
            t={t.learning}
          />
          <div className="w-full md:w-[45%]">
            <LearningPathsPanel
              paths={pathItems}
              loading={paths.isLoading}
              isError={paths.isError}
              onRetry={() => paths.refetch()}
              t={t.learning}
            />
          </div>
        </div>
      </div>
      {showCreateCourse && <CreateCourseModal onClose={() => setShowCreateCourse(false)} />}
      {showCreatePath && <CreatePathModal courses={courseItems} onClose={() => setShowCreatePath(false)} />}
    </div>
  );
}
