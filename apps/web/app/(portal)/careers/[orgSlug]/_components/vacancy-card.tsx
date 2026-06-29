'use client';

import Link from 'next/link';
import { useI18n } from '../../../../../lib/i18n';

interface VacancyCardProps {
  vacancy: {
    id: string;
    title: string;
    description: string | null;
    location: string | null;
    remotePolicy: string | null;
    contractType: string | null;
    salary: { min?: number; max?: number; currency?: string } | null;
    priority: string;
    createdAt: Date | string;
    company: { name: string } | null;
    unit: { name: string } | null;
  };
  orgSlug: string;
}

function isNew(createdAt: Date | string) {
  const created = new Date(createdAt);
  const now = new Date();
  return now.getTime() - created.getTime() < 7 * 24 * 60 * 60 * 1000;
}

function formatSalary(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k` : n.toString();
}

export function VacancyCard({ vacancy, orgSlug }: VacancyCardProps) {
  const { t } = useI18n();
  const initial = vacancy.company?.name?.charAt(0).toUpperCase() ?? 'T';
  const tags = [vacancy.contractType, vacancy.remotePolicy, vacancy.unit?.name].filter(Boolean);
  const currency = vacancy.salary?.currency ?? 'USD';
  const hasSalary = vacancy.salary && (vacancy.salary.min || vacancy.salary.max);

  return (
    <Link href={`/careers/${orgSlug}/${vacancy.id}`} className="group block">
      <div className="rounded-xl border border-[#EDEDED] bg-white p-5 transition-all duration-200 group-hover:border-[#1F114C]/20 group-hover:shadow-[0_4px_20px_rgba(0,0,0,0.08)]">
        {/* Top row */}
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#1F114C]">
              <span className="text-[11px] font-bold text-white">{initial}</span>
            </div>
            <div>
              <p className="text-[12px] font-medium text-[#333]">{vacancy.company?.name ?? 'Empresa'}</p>
              {vacancy.location && <p className="text-[11px] text-[#8B8B8B]">{vacancy.location}</p>}
            </div>
          </div>
          {vacancy.priority === 'urgent' ? (
            <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[10px] font-semibold text-amber-600">Urgente</span>
          ) : isNew(vacancy.createdAt) ? (
            <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-600">Nueva</span>
          ) : null}
        </div>

        {/* Title & description */}
        <h3 className="text-[15px] font-semibold text-[#1F114C] transition-colors group-hover:text-[#DD0C15]">{vacancy.title}</h3>
        {vacancy.description && (
          <p className="mt-1 line-clamp-2 text-[12px] text-[#585858]">{vacancy.description}</p>
        )}

        {/* Tags */}
        {tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <span key={tag} className="rounded-full bg-[#F6F6F6] px-2 py-0.5 text-[10px] text-[#585858]">{tag}</span>
            ))}
          </div>
        )}

        {/* Bottom */}
        <div className="mt-4 flex items-center justify-between border-t border-[#EDEDED] pt-4">
          <div>
            {hasSalary ? (
              <>
                <p className="text-[13px] font-semibold text-[#1F114C]">
                  {vacancy.salary!.min && vacancy.salary!.max
                    ? `${formatSalary(vacancy.salary!.min)} - ${formatSalary(vacancy.salary!.max)}`
                    : vacancy.salary!.min
                      ? `${formatSalary(vacancy.salary!.min)}+`
                      : `Hasta ${formatSalary(vacancy.salary!.max!)}`}
                </p>
                <p className="text-[10px] text-[#8B8B8B]">{currency} / ano</p>
              </>
            ) : (
              <p className="text-[12px] text-[#8B8B8B]">{t.portal.salaryNegotiable}</p>
            )}
          </div>
          <span className="rounded-lg bg-[#1F114C] px-4 py-1.5 text-[12px] font-medium text-white transition-colors group-hover:bg-[#DD0C15]">
            Aplicar
          </span>
        </div>
      </div>
    </Link>
  );
}
