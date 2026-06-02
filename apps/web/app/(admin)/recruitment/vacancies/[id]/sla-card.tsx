'use client';

import { useI18n } from '../../../../../lib/i18n';
import type { VacancyDetail } from '../../../../../lib/trpc-types';

interface SlaCardProps {
  vacancy: VacancyDetail;
}

export function SlaCard({ vacancy }: SlaCardProps) {
  const { t } = useI18n();

  const settings = vacancy.settings as { slaTargetDays?: number } | null;
  const slaTarget = settings?.slaTargetDays ?? 30;
  const createdDate = new Date(vacancy.createdAt);
  const now = new Date();
  const daysElapsed = Math.floor((now.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24));
  const isOverdue = daysElapsed > slaTarget;

  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h3 className="text-[14px] font-semibold text-[#1F114C] mb-3">{t.vacancies.slaAndTimeline}</h3>
      <div className="flex gap-3 mb-4">
        <div className={`flex-1 rounded-lg p-3 text-center ${isOverdue ? 'bg-red-50 border border-red-200' : 'bg-[#F6F6F6]'}`}>
          <p className={`text-[10px] ${isOverdue ? 'text-[#DD0C15]' : 'text-[#8B8B8B]'}`}>{t.vacancies.daysElapsed}</p>
          <p className={`text-[22px] font-bold ${isOverdue ? 'text-[#DD0C15]' : 'text-[#1F114C]'}`}>{daysElapsed}</p>
          <p className={`text-[10px] ${isOverdue ? 'text-[#DD0C15]' : 'text-[#8B8B8B]'}`}>SLA: {slaTarget} {t.vacancies.days}</p>
        </div>
        <div className="flex-1 bg-[#F6F6F6] rounded-lg p-3 text-center">
          <p className="text-[10px] text-[#8B8B8B]">{t.vacancies.positions}</p>
          <p className="text-[22px] font-bold text-[#1F114C]">{vacancy.positions}</p>
          <p className="text-[10px] text-[#8B8B8B]">{vacancy.status === 'closed' ? t.vacancies.statusClosed : vacancy.status}</p>
        </div>
      </div>

      {/* SLA Progress Bar */}
      <div className="mt-2">
        <div className="flex justify-between text-[10px] text-[#8B8B8B] mb-1">
          <span>0</span>
          <span>{slaTarget} {t.vacancies.days}</span>
        </div>
        <div className="w-full bg-[#F6F6F6] rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all ${isOverdue ? 'bg-[#DD0C15]' : 'bg-green-500'}`}
            style={{ width: `${Math.min((daysElapsed / slaTarget) * 100, 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
}
