'use client';

import { useState } from 'react';
import { Button, EmptyState, ErrorState, ProgressBar, Skeleton, StatusBadge, TextInput } from '../../../components';
import type { StatusTone } from '../../../components';
import { EnrollModal } from './enroll-modal';
import { useI18n, formatMessage } from '../../../lib/i18n';
import { formatCourseDuration } from './course-duration';

interface Course {
  id: string;
  title: string;
  category?: string | null;
  type: string;
  duration: number;
  isRequired: boolean;
  avgProgress: number;
  _count: { enrollments: number };
}

interface CourseCatalogProps {
  courses: Course[];
  loading: boolean;
  isError?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** Display only: "Inscribir" is offered to roles that can create enrollments. Defaults to true. */
  canEnroll?: boolean;
  /** The empty catalog's next step, when the viewer may create courses. */
  onCreateCourse?: () => void;
  t: {
    courseCatalog: string;
    searchCourse: string;
    filterAll: string;
    filterRequired: string;
    filterGap: string;
    filterCompany: string;
    enrolled: string;
    noCourses: string;
    noCoursesDesc: string;
    noResults: string;
  };
}

type TagKey = 'tagRequired' | 'tagGap' | 'tagCompany';
const TAGS: Record<'required' | 'gap' | 'company', { tone: StatusTone; labelKey: TagKey }> = {
  required: { tone: 'danger', labelKey: 'tagRequired' },
  gap: { tone: 'info', labelKey: 'tagGap' },
  company: { tone: 'brand', labelKey: 'tagCompany' },
};

type TypeKey = 'typeOnline' | 'typeInPerson' | 'typeHybrid';
const TYPE_LABEL: Record<string, TypeKey> = { online: 'typeOnline', in_person: 'typeInPerson', hybrid: 'typeHybrid' };

type Filter = 'all' | 'required' | 'gap' | 'company';

const CARD = 'w-full rounded-xl border border-border bg-white shadow-card md:w-[55%]';

export function CourseCatalog({
  courses,
  loading,
  isError,
  error,
  onRetry,
  canEnroll = true,
  onCreateCourse,
  t,
}: CourseCatalogProps) {
  const { t: tI18n } = useI18n();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [enrollCourse, setEnrollCourse] = useState<{ id: string; title: string } | null>(null);

  const filtered = courses.filter((c) => {
    if (search && !c.title.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter === 'required') return c.isRequired;
    if (filter === 'gap') return c.category?.toLowerCase().includes('brecha');
    if (filter === 'company') return !c.isRequired;
    return true;
  });

  const filters: { key: Filter; label: string }[] = [
    { key: 'all', label: t.filterAll },
    { key: 'required', label: t.filterRequired },
    { key: 'gap', label: t.filterGap },
    { key: 'company', label: t.filterCompany },
  ];

  function getTag(course: Course) {
    if (course.isRequired) return TAGS.required;
    if (course.category?.toLowerCase().includes('brecha')) return TAGS.gap;
    return TAGS.company;
  }

  if (loading) {
    return (
      <div className={`${CARD} p-4 md:p-5`} aria-busy="true">
        <Skeleton className="mb-3 h-4 w-40" />
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="mb-2 h-16 w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className={CARD}>
        <ErrorState error={error} onRetry={onRetry} />
      </div>
    );
  }

  const clearFilters = () => {
    setFilter('all');
    setSearch('');
  };

  return (
    <section className={`${CARD} flex flex-col p-4 md:max-h-96 md:p-5`} aria-labelledby="course-catalog-heading">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="course-catalog-heading" className="text-subheading font-semibold text-primary">
          {t.courseCatalog}
        </h2>
        <label className="w-full sm:w-48">
          <span className="sr-only">{tI18n.learning.searchCourseLabel}</span>
          <TextInput type="search" placeholder={t.searchCourse} value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
      </div>
      <div role="group" aria-label={tI18n.learning.filterLabel} className="mb-3 flex flex-wrap gap-1.5">
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className={`h-7 whitespace-nowrap rounded-full px-3 text-callout font-medium transition-colors duration-150 pointer-coarse:min-h-11 ${
              filter === f.key ? 'bg-brand text-white' : 'bg-surface text-secondary hover:bg-border'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          courses.length === 0 ? (
            <EmptyState
              size="compact"
              title={t.noCourses}
              description={t.noCoursesDesc}
              action={onCreateCourse ? { label: tI18n.learning.newCourseAction, onClick: onCreateCourse, variant: 'secondary' } : undefined}
            />
          ) : (
            <EmptyState
              size="compact"
              title={t.noResults}
              secondaryAction={{ label: tI18n.common.clearFilters, onClick: clearFilters }}
            />
          )
        ) : (
          <ul className="space-y-2">
            {filtered.map((course) => {
              const tag = getTag(course);
              const pct = course.avgProgress;
              const typeKey = TYPE_LABEL[course.type];
              return (
                <li key={course.id} className="rounded-lg border border-border p-3">
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="text-body font-medium text-primary">{course.title}</span>
                      <StatusBadge tone={tag.tone} icon="none">
                        {tI18n.learning[tag.labelKey]}
                      </StatusBadge>
                    </div>
                    <span className="text-callout tabular-nums text-secondary">{formatCourseDuration(course.duration)}</span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-3 text-callout text-secondary">
                      <span>
                        {course._count.enrollments} {t.enrolled}
                      </span>
                      <span>{typeKey ? tI18n.learning[typeKey] : course.type}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <ProgressBar
                        value={pct}
                        label={formatMessage(tI18n.learning.courseProgressAria, { title: course.title })}
                        hideLabel
                        className="w-20"
                      />
                      <span className="w-9 text-right text-callout font-medium tabular-nums text-secondary">{pct}%</span>
                      {canEnroll && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setEnrollCourse({ id: course.id, title: course.title })}
                          aria-label={formatMessage(tI18n.learning.enrollInCourse, { title: course.title })}
                        >
                          {tI18n.learning.enrollAction}
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {enrollCourse && (
        <EnrollModal courseId={enrollCourse.id} courseTitle={enrollCourse.title} onClose={() => setEnrollCourse(null)} />
      )}
    </section>
  );
}
