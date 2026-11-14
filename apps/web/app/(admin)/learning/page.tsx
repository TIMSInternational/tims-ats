'use client';

import { useState } from 'react';
import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { usePermissions } from '../../../lib/permissions';
import { manifestFor } from '../../../lib/nav/manifest';
import { Button, PageHeader } from '../../../components';
import { CreateCourseModal } from './create-course-modal';
import { CreatePathModal } from './create-path-modal';
import { LearningKpis } from './learning-kpis';
import { CourseCatalog } from './course-catalog';
import { LearningPathsPanel } from './learning-paths-panel';

export default function LearningPage() {
  const { t } = useI18n();
  const { roles, can } = usePermissions();
  const [showCreateCourse, setShowCreateCourse] = useState(false);
  const [showCreatePath, setShowCreatePath] = useState(false);
  const kpis = trpc.learning.getDashboardKpis.useQuery();
  const courses = trpc.learning.listCourses.useQuery({ pageSize: 50 });
  const paths = trpc.learning.listPaths.useQuery();

  const courseItems = courses.data?.courses ?? [];
  const pathItems = paths.data ?? [];
  // Display only: authoring actions are offered to roles that can create (the API still decides).
  const canCreate = can('learning', 'create');
  // Employees reach this page from "Mi aprendizaje": the title follows the link they tapped.
  const isSelfView = manifestFor(roles).shell === 'participant';

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <PageHeader
        title={isSelfView ? t.sidebar.myLearning : t.learning.title}
        actions={
          canCreate ? (
            <>
              <Button variant="secondary" onClick={() => setShowCreatePath(true)} disabled={courseItems.length === 0}>
                {t.learning.createPath}
              </Button>
              <Button icon={<PlusIcon />} onClick={() => setShowCreateCourse(true)}>
                {t.learning.newCourseAction}
              </Button>
            </>
          ) : undefined
        }
      />

      <div className="flex-1 space-y-4 overflow-y-auto p-4 md:p-5">
        <LearningKpis
          data={kpis.data}
          loading={kpis.isLoading}
          isError={kpis.isError}
          error={kpis.error}
          onRetry={() => kpis.refetch()}
          t={t.learning}
        />

        <div className="flex flex-col gap-4 md:flex-row">
          <CourseCatalog
            courses={courseItems}
            loading={courses.isLoading}
            isError={courses.isError}
            error={courses.error}
            onRetry={() => courses.refetch()}
            t={t.learning}
            canEnroll={canCreate}
            onCreateCourse={canCreate ? () => setShowCreateCourse(true) : undefined}
          />
          <div className="w-full md:w-[45%]">
            <LearningPathsPanel
              paths={pathItems}
              loading={paths.isLoading}
              isError={paths.isError}
              error={paths.error}
              onRetry={() => paths.refetch()}
              t={t.learning}
              showNeedsCourseHint={canCreate && courseItems.length === 0}
            />
          </div>
        </div>
      </div>
      {showCreateCourse && <CreateCourseModal onClose={() => setShowCreateCourse(false)} />}
      {showCreatePath && <CreatePathModal courses={courseItems} onClose={() => setShowCreatePath(false)} />}
    </div>
  );
}

function PlusIcon() {
  return (
    <svg className="size-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  );
}
