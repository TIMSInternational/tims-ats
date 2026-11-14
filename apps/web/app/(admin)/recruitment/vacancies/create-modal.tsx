'use client';

import { useRef, useState } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { Modal, Stepper } from '../../../../components';
import { WizardFooter } from './create-modal.footer';
import type { PickedUser } from '../../../../components/user-picker';
import { Step1BasicInfo, Step2Description, Step3Compensation } from './create-modal.fields';
import { VacancyOrgFields } from './create-modal.org-fields';
import type { Step, VacancyFormData } from './create-modal.helpers';
import { CompetenciesSection } from './competencies-section';
import {
  toCompetencyInput,
  validateCompetencyDrafts,
  type CompetencyDraft,
  type CompetencySuggestion,
} from './competencies-model';
import { isSalaryBandBlocked, salaryBandStatus } from '../../../../lib/money-amount';
import type { SalaryBandPatch } from './salary-band-fields';
import { useTenantLocale } from '../../../../lib/tenant-locale-context';

interface CreateModalProps {
  onConfirm: (data: VacancyFormData) => void;
  onClose: () => void;
  isPending: boolean;
  /** Server message from the last failed create, shown inside the wizard (not only as a toast). */
  errorMessage?: string | null;
}

export function CreateModal({ onConfirm, onClose, isPending, errorMessage }: CreateModalProps) {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>(1);

  // Step 1: Basic info
  const [title, setTitle] = useState('');
  const [positions, setPositions] = useState(1);
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium');
  const [contractType, setContractType] = useState('indefinido');
  const [location, setLocation] = useState('');
  const [remotePolicy, setRemotePolicy] = useState<'onsite' | 'remote' | 'hybrid'>('hybrid');
  const [businessUnitId, setBusinessUnitId] = useState<string | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [hiringManager, setHiringManager] = useState<PickedUser | null>(null);

  // Step 2: Description & requirements
  const [description, setDescription] = useState('');
  const [responsibilities, setResponsibilities] = useState('');
  const [requirements, setRequirements] = useState('');
  const [desiredQualifications, setDesiredQualifications] = useState('');
  const [benefits, setBenefits] = useState('');
  // AI-generated variants (vacancy-writer agent) — only sent on submit when
  // the user picked "Use this" for that variant; otherwise left empty/omitted.
  const [socialDescription, setSocialDescription] = useState('');
  const [whatsappDescription, setWhatsappDescription] = useState('');
  // "Competencias del puesto" (optional) and the AI's suggestions awaiting review.
  const [competencies, setCompetencies] = useState<CompetencyDraft[]>([]);
  const [competencySuggestions, setCompetencySuggestions] = useState<CompetencySuggestion[]>([]);

  // Step 3: Compensation & settings
  const [salaryMin, setSalaryMin] = useState('');
  const [salaryMax, setSalaryMax] = useState('');
  // The organization's currency until the recruiter picks one (null = not chosen yet, so a profile that
  // loads after the wizard opened still becomes the default).
  const tenant = useTenantLocale();
  const [chosenCurrency, setCurrency] = useState<string | null>(null);
  const currency = chosenCurrency ?? tenant.currency;
  const [salaryPeriod, setSalaryPeriod] = useState<'monthly' | 'yearly'>('monthly');
  // The band the person confirmed as correct although its minimum is below a tenth of its maximum.
  const [confirmedRangeKey, setConfirmedRangeKey] = useState<string | null>(null);
  const salaryStatus = salaryBandStatus(salaryMin, salaryMax, currency);
  const isSalaryBlocked = isSalaryBandBlocked(salaryStatus, confirmedRangeKey);
  const changeSalary = (patch: SalaryBandPatch) => {
    if (patch.salaryMin !== undefined) setSalaryMin(patch.salaryMin);
    if (patch.salaryMax !== undefined) setSalaryMax(patch.salaryMax);
    if (patch.currency !== undefined) setCurrency(patch.currency);
    if (patch.salaryPeriod !== undefined) setSalaryPeriod(patch.salaryPeriod);
  };
  const [slaTargetDays, setSlaTargetDays] = useState('30');
  const [autoPublish, setAutoPublish] = useState(false);
  const [requireApproval, setRequireApprovalState] = useState(true);
  // The server rejects autoPublish together with requireApproval, so turning approval on clears it.
  const setRequireApproval = (value: boolean) => {
    setRequireApprovalState(value);
    if (value) setAutoPublish(false);
  };

  const isStep1Valid = title.trim().length > 0;
  // "Siguiente" stays enabled on step 1: pressing it without a title says why and focuses the field
  // (feedback.md: show people when a command can't be carried out and why). The rule itself is unchanged.
  const [titleTouched, setTitleTouched] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const titleError = titleTouched && !isStep1Valid ? t.vacancies.titleRequiredToContinue : null;
  // No competencies is fine; a blank or repeated one must be fixed (or removed) before moving on.
  const isStep2Valid = validateCompetencyDrafts(competencies) === null;

  const buildDescription = () => {
    const parts: string[] = [];
    if (description.trim()) parts.push(description.trim());
    if (responsibilities.trim()) parts.push(`\n\n**Responsabilidades:**\n${responsibilities.trim()}`);
    if (requirements.trim()) parts.push(`\n\n**Requisitos:**\n${requirements.trim()}`);
    if (desiredQualifications.trim()) parts.push(`\n\n**Cualificaciones deseadas:**\n${desiredQualifications.trim()}`);
    if (benefits.trim()) parts.push(`\n\n**Beneficios:**\n${benefits.trim()}`);
    return parts.join('') || undefined;
  };

  const handleSubmit = () => {
    if (!isStep1Valid || !isStep2Valid || isSalaryBlocked) return;
    // The parsed amounts (grouping accepted, whole numbers for CRC/COP…), never parseInt of the typed text.
    const { min, max } = salaryStatus;
    const salary = min !== undefined || max !== undefined ? { min, max, currency, period: salaryPeriod } : undefined;

    onConfirm({
      title: title.trim(),
      description: buildDescription(),
      socialDescription: socialDescription.trim() || undefined,
      whatsappDescription: whatsappDescription.trim() || undefined,
      positions,
      priority,
      contractType,
      location: location.trim() || undefined,
      remotePolicy,
      salary,
      businessUnitId: businessUnitId ?? undefined,
      teamId: teamId ?? undefined,
      assignedTo: hiringManager?.id,
      competencies: competencies.length > 0 ? toCompetencyInput(competencies) : undefined,
      settings: {
        slaTargetDays: parseInt(slaTargetDays) || 30,
        autoPublish: requireApproval ? false : autoPublish,
        requireApproval,
      },
    });
  };

  const goNext = () => {
    if (step === 1 && !isStep1Valid) {
      setTitleTouched(true);
      titleRef.current?.focus();
      return;
    }
    if (step === 2 && !isStep2Valid) return;
    setStep((step + 1) as Step);
  };

  // Anything typed or chosen beyond the defaults: closing asks before discarding it (modality.md).
  const isDirty =
    [
      title,
      location,
      description,
      responsibilities,
      requirements,
      desiredQualifications,
      benefits,
      salaryMin,
      salaryMax,
    ].some((v) => v.trim() !== '') ||
    competencies.length > 0 ||
    socialDescription !== '' ||
    whatsappDescription !== '' ||
    hiringManager !== null ||
    businessUnitId !== null ||
    positions !== 1 ||
    priority !== 'medium' ||
    contractType !== 'indefinido' ||
    remotePolicy !== 'hybrid' ||
    slaTargetDays !== '30';

  const stepLabels = [
    t.vacancies.wizardStepBasic,
    t.vacancies.wizardStepDescription,
    t.vacancies.wizardStepCompensation,
  ];

  return (
    <Modal
      title={t.vacancies.createNewVacancy}
      onClose={onClose}
      size="lg"
      fullScreenOnMobile
      dirty={isDirty && !isPending}
      footer={
        <WizardFooter
          step={step}
          onBack={() => setStep((step - 1) as Step)}
          onNext={goNext}
          onSubmit={handleSubmit}
          nextDisabled={step === 2 && !isStep2Valid}
          submitDisabled={!isStep1Valid || !isStep2Valid || isSalaryBlocked}
          isPending={isPending}
        />
      }
    >
      <Stepper steps={stepLabels} current={step - 1} label={t.vacancies.wizardSteps} className="mb-6" />
      <p className="sr-only" aria-live="polite">
        {stepLabels[step - 1]}
      </p>

      {step === 1 && (
        <Step1BasicInfo
          title={title}
          setTitle={setTitle}
          titleError={titleError}
          titleRef={titleRef}
          location={location}
          setLocation={setLocation}
          remotePolicy={remotePolicy}
          setRemotePolicy={setRemotePolicy}
          contractType={contractType}
          setContractType={setContractType}
          positions={positions}
          setPositions={setPositions}
          priority={priority}
          setPriority={setPriority}
        />
      )}
      {step === 1 && (
        <div className="mt-4">
          <VacancyOrgFields
            businessUnitId={businessUnitId}
            teamId={teamId}
            hiringManager={hiringManager}
            onBusinessUnitChange={setBusinessUnitId}
            onTeamChange={setTeamId}
            onHiringManagerChange={setHiringManager}
          />
        </div>
      )}

      {step === 2 && (
        <Step2Description
          title={title}
          location={location}
          description={description}
          setDescription={setDescription}
          responsibilities={responsibilities}
          setResponsibilities={setResponsibilities}
          requirements={requirements}
          setRequirements={setRequirements}
          desiredQualifications={desiredQualifications}
          setDesiredQualifications={setDesiredQualifications}
          benefits={benefits}
          setBenefits={setBenefits}
          setSocialDescription={setSocialDescription}
          setWhatsappDescription={setWhatsappDescription}
          onSuggestedCompetencies={setCompetencySuggestions}
          competenciesSlot={
            <CompetenciesSection
              value={competencies}
              onChange={setCompetencies}
              suggestions={competencySuggestions}
              onSuggestionsChange={setCompetencySuggestions}
              title={title}
              descriptionText={[description, responsibilities, requirements].join('\n')}
            />
          }
        />
      )}

      {step === 3 && (
        <Step3Compensation
          salaryMin={salaryMin}
          salaryMax={salaryMax}
          currency={currency}
          salaryPeriod={salaryPeriod}
          onSalaryChange={changeSalary}
          salaryStatus={salaryStatus}
          wideConfirmed={confirmedRangeKey === salaryStatus.rangeKey}
          onConfirmWide={(confirmed) => setConfirmedRangeKey(confirmed ? salaryStatus.rangeKey : null)}
          slaTargetDays={slaTargetDays}
          setSlaTargetDays={setSlaTargetDays}
          autoPublish={autoPublish}
          setAutoPublish={setAutoPublish}
          requireApproval={requireApproval}
          setRequireApproval={setRequireApproval}
          title={title}
          location={location}
          remotePolicy={remotePolicy}
          contractType={contractType}
          positions={positions}
        />
      )}

      {errorMessage && (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-danger/30 bg-danger-bg px-3 py-2 text-callout text-danger"
        >
          {t.vacancies.createFailed}: {errorMessage}
        </p>
      )}
    </Modal>
  );
}
