'use client';

import { useState } from 'react';
import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import { toast } from '../../../../../lib/toast';
import { Button, Field, Select, TextInput } from '../../../../../components';
import { isFitEngineV2Enabled, useUpdateFitRequirementsViaCsharp } from '../../../../../lib/platform-api/fit-engine';

const EDUCATION_LEVELS = ['high_school', 'associate', 'bachelor', 'master', 'phd'] as const;
type EducationLevel = (typeof EDUCATION_LEVELS)[number];

interface FitRequirements {
  minYearsExperience?: number;
  requiredEducationLevel?: EducationLevel;
  requiredLanguages?: string[];
  assessments?: unknown;
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

  // FIT v2: the C# writer keeps the configured `assessments` (the TS mutation replaces the whole object and would
  // erase them) and reports any entry it dropped or adjusted.
  const viaCsharp = isFitEngineV2Enabled();
  const configuredAssessments = Array.isArray(current.assessments) ? current.assessments.length : 0;
  const updateV2 = useUpdateFitRequirementsViaCsharp({
    onSuccess: (issues) => {
      toast(t.fitRequirements.saved, { type: 'success' });
      if (issues.length > 0) {
        toast(t.fitRequirements.assessmentIssues.replace('{count}', String(issues.length)), { type: 'info' });
      }
      utils.vacancy.getById.invalidate({ id: vacancyId });
    },
    onError: () => toast(t.fitRequirements.saveError, { type: 'error' }),
  });
  const isSaving = viaCsharp ? updateV2.isPending : update.isPending;

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

    const input = {
      vacancyId,
      minYearsExperience: minYears === '' ? undefined : Number(minYears),
      requiredEducationLevel: educationLevel === '' ? undefined : (educationLevel as EducationLevel),
      requiredLanguages: requiredLanguages.length > 0 ? requiredLanguages : undefined,
    };
    if (viaCsharp) updateV2.mutate(input);
    else update.mutate(input);
  };

  return (
    <div className="rounded-xl bg-white p-4 shadow-card md:p-5">
      <h3 className="mb-1 text-subheading font-semibold text-brand">{t.fitRequirements.title}</h3>
      <p className="mb-4 text-callout text-secondary">{t.fitRequirements.description}</p>

      <div className="space-y-4">
        <Field label={t.fitRequirements.minYearsLabel} id={`fit-min-years-${vacancyId}`}>
          <TextInput
            type="number"
            inputMode="numeric"
            min={0}
            max={60}
            value={minYears}
            onChange={(e) => setMinYears(e.target.value)}
            className="tabular-nums"
          />
        </Field>

        <Field label={t.fitRequirements.educationLabel} id={`fit-education-${vacancyId}`}>
          <Select value={educationLevel} onChange={(e) => setEducationLevel(e.target.value)}>
            <option value="">{t.fitRequirements.educationNone}</option>
            {EDUCATION_LEVELS.map((level) => (
              <option key={level} value={level}>
                {educationLabels[level]}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label={t.fitRequirements.languagesLabel}
          help={t.fitRequirements.languagesHelp}
          id={`fit-languages-${vacancyId}`}
        >
          <TextInput
            value={languagesText}
            onChange={(e) => setLanguagesText(e.target.value)}
            placeholder={t.fitRequirements.languagesPlaceholder}
          />
        </Field>

        {viaCsharp && configuredAssessments > 0 && (
          <p className="text-callout text-secondary">
            {t.fitRequirements.assessmentsKept.replace('{count}', String(configuredAssessments))}
          </p>
        )}

        <Button variant="secondary" onClick={handleSave} loading={isSaving} loadingLabel={t.fitRequirements.saving}>
          {t.fitRequirements.saveButton}
        </Button>
      </div>
    </div>
  );
}
