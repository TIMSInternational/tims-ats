'use client';

import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { DataTable, EmptyState, StatusBadge } from '../../../components';

const STATUS_MAP: Record<string, { cls: string; label: string }> = {
  published: { cls: 'bg-green-50 text-green-600 border border-green-200', label: 'Publicado' },
  draft: { cls: 'bg-gray-100 text-gray-600', label: 'Borrador' },
  archived: { cls: 'bg-amber-50 text-amber-600', label: 'Archivado' },
};

export default function LearningPage() {
  const { t } = useI18n();
  const courses = trpc.learning.listCourses.useQuery({ pageSize: 50 });
  const items = courses.data?.courses ?? [];

  const columns = [
    { key: 'title', label: 'Curso' },
    { key: 'type', label: t.common.type },
    { key: 'status', label: t.common.status },
    { key: 'enrolled', label: 'Inscritos', align: 'center' as const },
    { key: 'duration', label: 'Duracion' },
  ];

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      <h1 className="text-lg font-semibold text-[#1F114C] mb-5">{t.sidebar.training}</h1>
      <DataTable columns={columns} loading={courses.isLoading} skeletonRows={6} empty={<EmptyState icon={<svg className="w-10 h-10 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" /></svg>} message="No hay cursos registrados" description="Crea el primer curso para comenzar" />}>
        {items.map((course) => (
          <tr key={course.id} className="border-b border-[#F6F6F6] hover:bg-[#FAFAFA] transition">
            <td className="px-4 py-3">
              <p className="text-[13px] font-medium text-[#333]">{course.title}</p>
              <p className="text-[10px] text-[#8B8B8B]">{course.category}</p>
            </td>
            <td className="px-4 py-3"><span className="text-[12px] text-[#585858]">{course.type}</span></td>
            <td className="px-4 py-3"><span className="text-[12px] text-[#585858]">{course.isRequired ? 'Obligatorio' : 'Opcional'}</span></td>
            <td className="px-4 py-3 text-center"><span className="text-[13px] text-[#333]">{course._count.enrollments}</span></td>
            <td className="px-4 py-3"><span className="text-[12px] text-[#585858]">{course.type}</span></td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}
