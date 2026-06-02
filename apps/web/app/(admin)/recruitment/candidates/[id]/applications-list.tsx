'use client';

import Link from 'next/link';
import { useI18n } from '../../../../../lib/i18n';
import { formatDate } from '../../../../../lib/format-utils';
import { StageBadge, StatusBadge } from '../../../../../components';

interface Application {
  id: string;
  status: string;
  source: string;
  appliedAt: Date | string;
  vacancy: { id: string; title: string; status: string };
  currentStage: { id: string; name: string; order: number };
}

export function ApplicationsList({ applications }: { applications: Application[] }) {
  const { t } = useI18n();

  const statusMap: Record<string, { cls: string; label: string }> = {
    active: { cls: 'bg-green-50 text-green-600 border border-green-200', label: 'Activa' },
    rejected: { cls: 'bg-red-50 text-red-600', label: 'Rechazada' },
    hired: { cls: 'bg-[#1F114C] text-white', label: 'Contratada' },
  };

  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h3 className="text-[14px] font-semibold text-[#1F114C] mb-4">{t.candidates.applications}</h3>
      <div className="space-y-3">
        {applications.map((app) => (
          <Link
            key={app.id}
            href={`/recruitment/vacancies/${app.vacancy.id}`}
            className="flex items-center justify-between p-3 rounded-lg bg-[#F6F6F6] hover:bg-[#EDEDED] transition"
          >
            <div>
              <p className="text-[13px] font-medium text-[#333]">{app.vacancy.title}</p>
              <div className="flex items-center gap-2 mt-1">
                <StageBadge name={app.currentStage.name} order={app.currentStage.order} />
                <span className="text-[10px] text-[#8B8B8B]">{formatDate(app.appliedAt)}</span>
              </div>
            </div>
            <StatusBadge status={app.status} map={statusMap} />
          </Link>
        ))}
      </div>
    </div>
  );
}
