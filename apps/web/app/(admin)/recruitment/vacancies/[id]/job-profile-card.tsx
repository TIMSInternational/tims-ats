'use client';

import { useI18n } from '../../../../../lib/i18n';

interface DiscRange { min: number; max: number }
interface Competency { name: string; level: number }
interface Kpi { name: string; target: string }
interface Requirement { text: string; isRequired: boolean }

interface JobProfileCardProps {
  jobProfile: {
    discTargets: unknown;
    competencies: unknown;
    pcaExpected: unknown;
    milExpected: unknown;
    kpis: unknown;
    requirements: unknown;
  };
}

export function JobProfileCard({ jobProfile }: JobProfileCardProps) {
  const { t } = useI18n();

  const disc = jobProfile.discTargets as Record<string, DiscRange> | null;
  const pca = jobProfile.pcaExpected as Record<string, DiscRange> | null;
  const mil = jobProfile.milExpected as { minScore?: number } | null;
  const competencies = (Array.isArray(jobProfile.competencies) ? jobProfile.competencies : []) as Competency[];
  const kpis = (Array.isArray(jobProfile.kpis) ? jobProfile.kpis : []) as Kpi[];
  const requirements = (Array.isArray(jobProfile.requirements) ? jobProfile.requirements : []) as Requirement[];

  const discSource = pca ?? disc;
  const discEntries = discSource ? [
    { label: t.vacancies.dominance, key: 'dominance' },
    { label: t.vacancies.influence, key: 'influence' },
    { label: t.vacancies.steadiness, key: 'steadiness' },
    { label: t.vacancies.compliance, key: 'compliance' },
  ] : [];

  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h3 className="text-[14px] font-semibold text-[#1F114C] mb-4">{t.vacancies.jobProfile}</h3>

      {/* DISC Targets */}
      {discSource && discEntries.length > 0 && (
        <div className="mb-4">
          <p className="text-[12px] text-[#585858] font-medium mb-2">{t.vacancies.pcaExpected}</p>
          <div className="flex gap-2">
            {discEntries.map((entry) => {
              const range = (discSource as Record<string, DiscRange>)[entry.key];
              if (!range) return null;
              const avg = (range.min + range.max) / 2;
              return (
                <div key={entry.key} className="flex-1 bg-[#F6F6F6] rounded-lg p-3 text-center">
                  <p className="text-[10px] text-[#8B8B8B]">{entry.label}</p>
                  <p className="text-[18px] font-bold text-[#1F114C]">{range.min}-{range.max}</p>
                  <div className="w-full bg-[#EDEDED] rounded-full h-1.5 mt-1">
                    <div className="h-1.5 bg-[#1F114C] rounded-full" style={{ width: `${avg}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* MIL Expected */}
      {mil?.minScore && (
        <div className="mb-4">
          <p className="text-[12px] text-[#585858] font-medium mb-2">{t.vacancies.milExpected}</p>
          <div className="flex items-center gap-3">
            <div className="flex-1 bg-[#F6F6F6] rounded-full h-3">
              <div className="h-3 bg-[#5C4B99] rounded-full" style={{ width: `${mil.minScore}%` }} />
            </div>
            <span className="text-[13px] text-[#1F114C] font-medium w-16">{t.vacancies.minScore}: {mil.minScore}</span>
          </div>
        </div>
      )}

      {/* Competencies */}
      {competencies.length > 0 && (
        <div className="mb-4">
          <p className="text-[12px] text-[#585858] font-medium mb-2">{t.vacancies.competencies}</p>
          <div className="grid grid-cols-2 gap-2">
            {competencies.map((c, i) => (
              <div key={i} className="flex items-center justify-between bg-[#F6F6F6] rounded-lg px-3 py-2">
                <span className="text-[12px] text-[#333]">{c.name}</span>
                <div className="flex gap-0.5">
                  {Array.from({ length: 5 }).map((_, j) => (
                    <span key={j} className={`w-2 h-2 rounded-full ${j < c.level ? 'bg-[#1F114C]' : 'bg-[#EDEDED]'}`} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Requirements */}
      {requirements.length > 0 && (
        <div className="mb-4">
          <p className="text-[12px] text-[#585858] font-medium mb-2">{t.vacancies.mandatoryReqs}</p>
          <div className="space-y-1.5">
            {requirements.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${r.isRequired ? 'bg-[#DD0C15]' : 'bg-[#8B8B8B]'}`} />
                <span className="text-[12px] text-[#333]">{r.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* KPIs */}
      {kpis.length > 0 && (
        <div>
          <p className="text-[12px] text-[#585858] font-medium mb-2">{t.vacancies.kpis}</p>
          <div className="flex gap-3">
            {kpis.map((kpi, i) => (
              <div key={i} className="flex-1 bg-[#F6F6F6] rounded-lg p-2.5 text-center">
                <p className="text-[10px] text-[#8B8B8B]">{kpi.name}</p>
                <p className="text-[14px] font-bold text-[#1F114C]">{kpi.target}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
