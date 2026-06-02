'use client';

import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { formatDate } from '../../../../lib/format-utils';
import { DataTable, EmptyState, StatusBadge } from '../../../../components';

const STATUS_MAP: Record<string, { cls: string; label: string }> = {
  draft: { cls: 'bg-gray-100 text-gray-600', label: 'Borrador' },
  active: { cls: 'bg-green-50 text-green-600 border border-green-200', label: 'Activa' },
  closed: { cls: 'bg-blue-50 text-blue-600 border border-blue-200', label: 'Cerrada' },
};

export default function ClimatePage() {
  const { t } = useI18n();
  const surveys = trpc.engagement.listSurveys.useQuery({ limit: 50 });
  const items = surveys.data?.items ?? [];

  const columns = [
    { key: 'title', label: 'Encuesta' },
    { key: 'type', label: t.common.type },
    { key: 'status', label: t.common.status },
    { key: 'responses', label: 'Respuestas', align: 'center' as const },
    { key: 'created', label: t.common.date },
  ];

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      <h1 className="text-lg font-semibold text-[#1F114C] mb-5">{t.sidebar.climate}</h1>
      <DataTable columns={columns} loading={surveys.isLoading} skeletonRows={6} empty={<EmptyState icon={<svg className="w-10 h-10 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" /></svg>} message="No hay encuestas configuradas" description="Crea la primera encuesta de clima" />}>
        {items.map((survey) => (
          <tr key={survey.id} className="border-b border-[#F6F6F6] hover:bg-[#FAFAFA] transition">
            <td className="px-4 py-3"><p className="text-[13px] font-medium text-[#333]">{survey.title}</p></td>
            <td className="px-4 py-3"><span className="text-[12px] text-[#585858]">{survey.type}</span></td>
            <td className="px-4 py-3"><StatusBadge status={survey.status} map={STATUS_MAP} /></td>
            <td className="px-4 py-3 text-center"><span className="text-[13px] text-[#333]">{survey.responseCount}</span></td>
            <td className="px-4 py-3"><span className="text-[12px] text-[#8B8B8B]">{formatDate(survey.createdAt)}</span></td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}
