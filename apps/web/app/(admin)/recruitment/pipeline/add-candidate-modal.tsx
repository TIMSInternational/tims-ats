'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { Button, BUTTON_GROUP_CLASSES, Modal, Stepper } from '../../../../components';
import { Step1Fields, Step2Fields, Step3Fields } from './add-candidate-modal.fields';
import type { Step, ProcessStep } from './add-candidate-modal.helpers';
import { useI18n } from '../../../../lib/i18n';
import { formatMessage } from '../../../../lib/i18n/format';

interface AddCandidateModalProps {
  vacancyId: string;
  vacancyTitle: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function AddCandidateModal({ vacancyId, vacancyTitle, onClose, onSuccess }: AddCandidateModalProps) {
  const { t } = useI18n();
  const p = t.pipeline;
  const [step, setStep] = useState<Step>(1);
  const [processStep, setProcessStep] = useState<ProcessStep>('idle');

  // Step 1: Personal info
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [location, setLocation] = useState('');

  // Step 2: Professional info
  const [currentTitle, setCurrentTitle] = useState('');
  const [currentCompany, setCurrentCompany] = useState('');
  const [yearsExperience, setYearsExperience] = useState('3');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [skills, setSkills] = useState('');
  const [notes, setNotes] = useState('');

  // Step 3: Application details
  const [source, setSource] = useState('manual');
  const [poolType, setPoolType] = useState('active');
  const [referrerName, setReferrerName] = useState('');

  const createCandidate = trpc.candidate.create.useMutation();
  const applyToVacancy = trpc.candidate.applyToVacancy.useMutation();
  const utils = trpc.useUtils();

  const isStep1Valid = firstName.trim() && lastName.trim() && email.trim();
  const isPending = processStep !== 'idle';
  const fullName = `${firstName.trim()} ${lastName.trim()}`;
  // Anything typed makes closing ask "¿Descartar los cambios?" (the shared Modal's dirty guard).
  const isDirty = [
    firstName,
    lastName,
    email,
    phone,
    location,
    currentTitle,
    currentCompany,
    linkedinUrl,
    skills,
    notes,
    referrerName,
  ].some((value) => value.trim() !== '');
  const stepLabels = [p.addCandidateStepPersonal, p.addCandidateStepProfessional, p.addCandidateStepSource];
  const step1HintId = 'add-candidate-step1-hint';

  const handleSubmit = async () => {
    if (!isStep1Valid) return;
    try {
      setProcessStep('creating');

      let candidateId: string;
      try {
        const candidate = await createCandidate.mutateAsync({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          phone: phone.trim() || undefined,
          source,
          poolType,
          location: location.trim() || undefined,
          currentTitle: currentTitle.trim() || undefined,
          currentCompany: currentCompany.trim() || undefined,
          yearsExperience: parseInt(yearsExperience) || undefined,
          linkedinUrl: linkedinUrl.trim() ? linkedinUrl.trim() : undefined,
          skills: skills.trim()
            ? skills
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined,
          notes: notes.trim() || undefined,
        });
        candidateId = candidate.id;
      } catch (createErr) {
        // Candidate with this email already exists — find them and use their ID
        const msg = createErr instanceof Error ? createErr.message : '';
        if (msg.includes('Unique constraint') || msg.includes('unique') || msg.includes('already exists')) {
          const results = await utils.candidate.search.fetch({ query: email.trim(), limit: 1 });
          if (results.length > 0) {
            candidateId = results[0].id;
            toast(formatMessage(p.addCandidateExists, { name: fullName }), { type: 'info' });
          } else {
            throw new Error(p.addCandidateExistsNotFound);
          }
        } else {
          throw createErr;
        }
      }

      setProcessStep('applying');
      await applyToVacancy.mutateAsync({ candidateId, vacancyId, source });

      toast(formatMessage(p.addCandidateAdded, { name: fullName }), { type: 'success' });
      onSuccess();
    } catch (err) {
      const msg = err instanceof Error ? err.message : p.addCandidateError;
      if (msg.includes('unique') || msg.includes('Unique') || msg.includes('already')) {
        toast(t.pipeline.alreadyApplying, { type: 'error' });
      } else {
        toast(msg, { type: 'error' });
      }
      setProcessStep('idle');
    }
  };

  const footer = (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-h-5">
        {isPending ? (
          <span role="status" className="text-callout text-secondary">
            {processStep === 'creating' ? p.addCandidateCreating : p.addCandidateApplying}
          </span>
        ) : (
          step === 1 &&
          !isStep1Valid && (
            <p id={step1HintId} className="text-callout text-secondary">
              {p.addCandidateStep1Hint}
            </p>
          )
        )}
      </div>
      <div className={BUTTON_GROUP_CLASSES}>
        <Button variant="secondary" onClick={onClose} disabled={isPending}>
          {t.common.cancel}
        </Button>
        {step > 1 && (
          <Button variant="secondary" onClick={() => setStep((step - 1) as Step)} disabled={isPending}>
            {p.addCandidateBack}
          </Button>
        )}
        {step < 3 ? (
          <Button
            variant="primary"
            onClick={() => setStep((step + 1) as Step)}
            disabled={step === 1 && !isStep1Valid}
            aria-describedby={step === 1 && !isStep1Valid ? step1HintId : undefined}
          >
            {p.addCandidateNext}
          </Button>
        ) : (
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={!isStep1Valid}
            loading={isPending}
            loadingLabel={p.addCandidateSubmitting}
          >
            {p.addCandidateSubmit}
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <Modal title={p.addCandidateTitle} onClose={onClose} size="lg" dirty={isDirty && !isPending} footer={footer}>
      {/* Vacancy the candidate is added to */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 bg-brand-tint rounded-lg px-3 py-2.5 mb-5">
        <svg
          className="size-4 shrink-0 text-brand"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <rect x="2" y="7" width="20" height="14" rx="2" />
          <path d="M16 7V5a4 4 0 00-8 0v2" />
        </svg>
        <span className="text-body text-brand font-medium">{vacancyTitle}</span>
        <span className="text-callout text-secondary sm:ml-auto">{p.willAddToFirstStage}</span>
      </div>

      <Stepper steps={stepLabels} current={step - 1} className="mb-6" />
      {/* Step 1: Personal Info */}
      {step === 1 && (
        <Step1Fields
          firstName={firstName}
          setFirstName={setFirstName}
          lastName={lastName}
          setLastName={setLastName}
          email={email}
          setEmail={setEmail}
          phone={phone}
          setPhone={setPhone}
          location={location}
          setLocation={setLocation}
        />
      )}

      {/* Step 2: Professional Profile */}
      {step === 2 && (
        <Step2Fields
          currentTitle={currentTitle}
          setCurrentTitle={setCurrentTitle}
          currentCompany={currentCompany}
          setCurrentCompany={setCurrentCompany}
          yearsExperience={yearsExperience}
          setYearsExperience={setYearsExperience}
          linkedinUrl={linkedinUrl}
          setLinkedinUrl={setLinkedinUrl}
          skills={skills}
          setSkills={setSkills}
          notes={notes}
          setNotes={setNotes}
        />
      )}

      {/* Step 3: Source & Application */}
      {step === 3 && (
        <Step3Fields
          source={source}
          setSource={setSource}
          poolType={poolType}
          setPoolType={setPoolType}
          referrerName={referrerName}
          setReferrerName={setReferrerName}
          firstName={firstName}
          lastName={lastName}
          email={email}
          currentTitle={currentTitle}
          currentCompany={currentCompany}
          skills={skills}
          vacancyTitle={vacancyTitle}
        />
      )}
    </Modal>
  );
}
