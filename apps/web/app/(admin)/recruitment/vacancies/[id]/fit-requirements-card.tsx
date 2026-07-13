'use client';

import { useState } from 'react';
import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import { toast } from '../../../../../lib/toast';

const EDUCATION_LEVELS = ['high_school', 'associate', 'bachelor', 'master', 'phd'] as const;
type EducationLevel = (typeof EDUCATION_LEVELS)[number];

interface FitRequirements {
  minYearsExperience?: number;
  requiredEducationLevel?: EducationLevel;
  requiredLanguages?: string[];
}

// Structured requirements consumed by the FIT Engine's Experience/Education/
// Languages dimension scoring (fitEngineService.computeFitScore) — separate
// from the free-text checklist shown above in JobProfileCard, which is
// intentionally NOT parsed by the FIT Engine (arbitrary HR prose, not
// structured data).
export function FitRequirementsCard({ vacancyId, fitRequirements }: { vacancyId: string; fitRequirements: unknown }) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const current = (fitRequirements ?? {}) as FitRequirements;

  const [minYears, setMinYears] = useState(current.minYearsExperience?.toString() ?? '');
  const [educationLevel, setEducationLevel] = useState<string>(current.requiredEducationLevel ?? '');
  const [languagesText, setLanguagesText] = useState((current.requiredLanguages ?? []).join(', '));

  const update = trpc.vacancy.updateFitRequirements.useMutation({
    onSuccess: () => {
      toast(t.fitRequirements.saved, { type: 'success' });
      utils.vacancy.getById.invalidate({ id: vacancyId });
    },
    onError: (err) => toast(err.message, { type: 'error' }),
  });

  const educationLabels: Record<EducationLevel, string> = {
    high_school: t.fitRequirements.educationHighSchool,
    associate: t.fitRequirements.educationAssociate,
    bachelor: t.fitRequirements.educationBachelor,
    master: t.fitRequirements.educationMaster,
    phd: t.fitRequirements.educationPhd,
  };

  const handleSave = () => {
    const requiredLanguages = languagesText
      .split(',')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    update.mutate({
      vacancyId,
      minYearsExperience: minYears === '' ? undefined : Number(minYears),
      requiredEducationLevel: educationLevel === '' ? undefined : (educationLevel as EducationLevel),
      requiredLanguages: requiredLanguages.length > 0 ? requiredLanguages : undefined,
    });
  };

  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h3 className="text-[14px] font-semibold text-[#1F114C] mb-1">{t.fitRequirements.title}</h3>
      <p className="text-[11px] text-[#8B8B8B] mb-4">{t.fitRequirements.description}</p>

      <div className="space-y-3">
        <div>
          <label className="block text-[12px] font-medium text-[#585858] mb-1.5">{t.fitRequirements.minYearsLabel}</label>
          <input
            type="number"
            min={0}
            max={60}
            value={minYears}
            onChange={(e) => setMinYears(e.target.value)}
            className="w-full bg-white border border-[#EDEDED] rounded-lg px-3 h-9 text-[13px] text-[#333] focus:outline-none focus:border-[#1F114C]/40"
          />
        </div>

        <div>
          <label className="block text-[12px] font-medium text-[#585858] mb-1.5">{t.fitRequirements.educationLabel}</label>
          <select
            value={educationLevel}
            onChange={(e) => setEducationLevel(e.target.value)}
            className="w-full bg-white border border-[#EDEDED] rounded-lg px-3 h-9 text-[13px] text-[#333] focus:outline-none focus:border-[#1F114C]/40"
          >
            <option value="">{t.fitRequirements.educationNone}</option>
            {EDUCATION_LEVELS.map((level) => (
              <option key={level} value={level}>{educationLabels[level]}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[12px] font-medium text-[#585858] mb-1.5">{t.fitRequirements.languagesLabel}</label>
          <input
            value={languagesText}
            onChange={(e) => setLanguagesText(e.target.value)}
            placeholder={t.fitRequirements.languagesPlaceholder}
            className="w-full bg-white border border-[#EDEDED] rounded-lg px-3 h-9 text-[13px] text-[#333] focus:outline-none focus:border-[#1F114C]/40"
          />
        </div>

        <button
          onClick={handleSave}
          disabled={update.isPending}
          className="bg-[#DD0C15] text-white px-4 h-8 rounded-lg text-[12px] font-medium hover:bg-[#c00b13] transition disabled:opacity-50"
        >
          {update.isPending ? t.fitRequirements.saving : t.fitRequirements.saveButton}
        </button>
      </div>
    </div>
  );
}
