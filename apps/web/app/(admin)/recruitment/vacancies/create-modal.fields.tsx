'use client';

import { useState, type ReactNode, type Ref } from 'react';
import { CONTRACT_TYPES, withoutCopiedSections } from './create-modal.helpers';
import { useI18n } from '../../../../lib/i18n';
import { Field, Select, TextArea, TextInput } from '../../../../components';
import { AiGeneratePanel, InclusiveCheckPanel } from './create-modal.ai-panel';
import { VacancyChoiceGroups } from './vacancy-choice-groups';

export { Step3Compensation } from './create-modal.compensation';

interface Step1Props {
  title: string;
  setTitle: (v: string) => void;
  /** Shown after "Siguiente" was pressed with no title (the title is the one required field). */
  titleError?: string | null;
  titleRef?: Ref<HTMLInputElement>;
  location: string;
  setLocation: (v: string) => void;
  remotePolicy: 'onsite' | 'remote' | 'hybrid';
  setRemotePolicy: (v: 'onsite' | 'remote' | 'hybrid') => void;
  contractType: string;
  setContractType: (v: string) => void;
  positions: number;
  setPositions: (v: number) => void;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  setPriority: (v: 'low' | 'medium' | 'high' | 'urgent') => void;
}

export function Step1BasicInfo({
  title,
  setTitle,
  titleError,
  titleRef,
  location,
  setLocation,
  remotePolicy,
  setRemotePolicy,
  contractType,
  setContractType,
  positions,
  setPositions,
  priority,
  setPriority,
}: Step1Props) {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <p className="text-callout text-secondary">{t.vacancies.requiredFieldsNote}</p>
      <Field label={t.vacancies.titleField} required error={titleError ?? undefined}>
        <TextInput
          ref={titleRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t.vacancies.titlePlaceholder}
          maxLength={200}
          autoFocus
        />
      </Field>

      <Field label={t.vacancies.location}>
        <TextInput
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder={t.vacancies.locationPlaceholder}
          maxLength={200}
        />
      </Field>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t.vacancies.contractTypeLabel}>
          <Select value={contractType} onChange={(e) => setContractType(e.target.value)}>
            {CONTRACT_TYPES.map((value) => (
              <option key={value} value={value}>
                {t.portal.contractTypes[value]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t.vacancies.positions}>
          <TextInput
            type="number"
            inputMode="numeric"
            value={positions}
            onChange={(e) => setPositions(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
            min={1}
            max={100}
          />
        </Field>
      </div>

      <VacancyChoiceGroups
        remotePolicy={remotePolicy}
        onRemotePolicyChange={setRemotePolicy}
        priority={priority}
        onPriorityChange={setPriority}
      />
    </div>
  );
}

interface Step2Props {
  title: string;
  location: string;
  description: string;
  setDescription: (v: string) => void;
  responsibilities: string;
  setResponsibilities: (v: string) => void;
  requirements: string;
  setRequirements: (v: string) => void;
  desiredQualifications: string;
  setDesiredQualifications: (v: string) => void;
  benefits: string;
  setBenefits: (v: string) => void;
  setSocialDescription: (v: string) => void;
  setWhatsappDescription: (v: string) => void;
  /** Competencies the AI suggested with the description (shown for review, never auto-applied). */
  onSuggestedCompetencies?: (list: Array<{ name: string; description: string; level: number }>) => void;
  /** "Competencias del puesto", rendered right below "Generar con IA". */
  competenciesSlot?: ReactNode;
}

interface FormalSnapshot {
  description: string;
  responsibilities: string;
  requirements: string;
  benefits: string;
}

export function Step2Description({
  title,
  location,
  description,
  setDescription,
  responsibilities,
  setResponsibilities,
  requirements,
  setRequirements,
  desiredQualifications,
  setDesiredQualifications,
  benefits,
  setBenefits,
  setSocialDescription,
  setWhatsappDescription,
  onSuggestedCompetencies,
  competenciesSlot,
}: Step2Props) {
  const { t } = useI18n();
  // What the four fields held before "Usar esta variante" replaced them (generative-ai.md › Outputs: revertible).
  const [snapshot, setSnapshot] = useState<FormalSnapshot | null>(null);
  const formalTargetsHaveText = [description, responsibilities, requirements, benefits].some((v) => v.trim() !== '');

  const restore = (s: FormalSnapshot) => {
    setDescription(s.description);
    setResponsibilities(s.responsibilities);
    setRequirements(s.requirements);
    setBenefits(s.benefits);
    setSnapshot(null);
  };

  return (
    <div className="space-y-4">
      <AiGeneratePanel
        title={title}
        location={location}
        formalWillReplace={formalTargetsHaveText}
        onUseFormal={(desc, sections) => {
          setSnapshot({ description, responsibilities, requirements, benefits });
          // The three sections get their own fields below; leave them out of "Sobre el cargo", or the
          // saved description would list them twice (F-6). Any other section is kept.
          setDescription(withoutCopiedSections(desc, sections));
          setResponsibilities(sections.responsibilities.map((r) => `- ${r}`).join('\n'));
          setRequirements(sections.requirements.map((r) => `- ${r}`).join('\n'));
          setBenefits(sections.benefits.map((r) => `- ${r}`).join('\n'));
        }}
        onUndoFormal={snapshot ? () => restore(snapshot) : undefined}
        onUseSocial={setSocialDescription}
        onUseWhatsapp={setWhatsappDescription}
        onSuggestedCompetencies={onSuggestedCompetencies}
      />
      {competenciesSlot}
      <div>
        <Field label={t.vacancies.aboutRole}>
          <TextArea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t.vacancies.descPlaceholder}
            maxLength={2000}
            rows={3}
            autoFocus
          />
        </Field>
        <div className="mt-2">
          <InclusiveCheckPanel text={description} />
        </div>
      </div>
      <Field label={t.vacancies.keyResponsibilities} help={t.vacancies.oneLinePerResp}>
        <TextArea
          value={responsibilities}
          onChange={(e) => setResponsibilities(e.target.value)}
          placeholder={t.vacancies.responsibilitiesPlaceholder}
          maxLength={2000}
          rows={4}
        />
      </Field>
      <Field label={t.vacancies.minRequirements}>
        <TextArea
          value={requirements}
          onChange={(e) => setRequirements(e.target.value)}
          placeholder={t.vacancies.requirementsPlaceholder}
          maxLength={2000}
          rows={3}
        />
      </Field>
      <Field label={t.vacancies.desiredQualifications}>
        <TextArea
          value={desiredQualifications}
          onChange={(e) => setDesiredQualifications(e.target.value)}
          placeholder={t.vacancies.desiredPlaceholder}
          maxLength={2000}
          rows={2}
        />
      </Field>
      <Field label={t.vacancies.benefitsLabel}>
        <TextArea
          value={benefits}
          onChange={(e) => setBenefits(e.target.value)}
          placeholder={t.vacancies.benefitsPlaceholder}
          maxLength={1500}
          rows={3}
        />
      </Field>
    </div>
  );
}
