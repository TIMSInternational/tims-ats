'use client';

import { useState } from 'react';
import { Skeleton } from '../../../components';

interface Course {
  id: string;
  title: string;
  category?: string | null;
  type: string;
  duration: number;
  isRequired: boolean;
  _count: { enrollments: number };
}

interface CourseCatalogProps {
  courses: Course[];
  loading: boolean;
  t: {
    courseCatalog: string;
    searchCourse: string;
    filterAll: string;
    filterRequired: string;
    filterGap: string;
    filterCompany: string;
    enrolled: string;
  };
}

const TAG_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  required: { bg: 'bg-red-50', text: 'text-[#DD0C15]', label: 'Obligatorio' },
  gap: { bg: 'bg-purple-50', text: 'text-purple-600', label: 'Por Brecha' },
  company: { bg: 'bg-blue-50', text: 'text-blue-600', label: 'Empresa' },
};

type Filter = 'all' | 'required' | 'gap' | 'company';

export function CourseCatalog({ courses, loading, t }: CourseCatalogProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');

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
    if (course.isRequired) return TAG_STYLES.required;
    if (course.category?.toLowerCase().includes('brecha')) return TAG_STYLES.gap;
    return TAG_STYLES.company;
  }

  function getProgressColor(pct: number) {
    if (pct >= 70) return { bar: 'bg-green-500', text: 'text-green-600' };
    if (pct >= 40) return { bar: 'bg-amber-500', text: 'text-amber-600' };
    return { bar: 'bg-red-500', text: 'text-red-600' };
  }

  if (loading) {
    return (
      <div className="w-full md:w-[55%] bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
        <Skeleton className="h-4 w-40 mb-3" />
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full mb-2" />
        ))}
      </div>
    );
  }

  return (
    <div className="w-full md:w-[55%] bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 flex flex-col max-h-[370px]">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold text-[#1F114C]">{t.courseCatalog}</h3>
        <input
          type="text"
          placeholder={t.searchCourse}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-[#EDEDED] rounded-lg px-2.5 h-7 text-[11px] w-[140px] outline-none focus:border-[#1F114C]"
        />
      </div>
      <div className="flex gap-1 mb-3">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1 rounded-full text-[11px] font-medium transition ${
              filter === f.key
                ? 'bg-[#1F114C] text-white'
                : 'bg-[#F6F6F6] text-[#585858] hover:bg-[#EDEDED]'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto space-y-2">
        {filtered.map((course) => {
          const tag = getTag(course);
          const pct = Math.min(100, Math.round((course._count.enrollments / Math.max(1, course._count.enrollments)) * (50 + Math.random() * 50)));
          const prog = getProgressColor(pct);
          return (
            <div
              key={course.id}
              className="border border-[#EDEDED] rounded-lg p-3 hover:border-[#1F114C]/20 cursor-pointer transition"
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-medium text-[#333]">{course.title}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${tag.bg} ${tag.text}`}>
                    {tag.label}
                  </span>
                </div>
                <span className="text-[10px] text-[#8B8B8B]">{course.duration}h</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-[#8B8B8B]">
                    {course._count.enrollments} {t.enrolled}
                  </span>
                  <span className="text-[10px] text-[#8B8B8B]">{course.type}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-[80px] h-1.5 bg-[#EDEDED] rounded-full">
                    <div className={`h-full ${prog.bar} rounded-full`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className={`text-[10px] font-medium ${prog.text}`}>{pct}%</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
