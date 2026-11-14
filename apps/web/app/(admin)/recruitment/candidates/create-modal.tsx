'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { Button, Modal, Stepper } from '../../../../components';
import { DiscardChangesPrompt } from '../../../../components/discard-changes-prompt';
import type { Step } from './create-modal.helpers';
import { Step1Fields, Step2Fields, Step3Fields } from './create-modal.fields';

interface CreateModalProps {
  onConfirm: (data: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    source: string;
    poolType: string;
    location?: string;
    currentTitle?: string;
    currentCompany?: string;
    yearsExperience?: number;
    skills?: string[];
    linkedinUrl?: string;
    notes?: string;
  }) => void;
  onClose: () => void;
  isPending: boolean;
  /** tRPC error code of a failed create ('CONFLICT' = the email is already registered). */
  errorCode?: string;
}

export function CreateModal({ onConfirm, onClose, isPending, errorCode }: CreateModalProps) {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>(1);

  // Step 1: Personal
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [location, setLocation] = useState('');

  // Step 2: Professional
  const [currentTitle, setCurrentTitle] = useState('');
  const [currentCompany, setCurrentCompany] = useState('');
  const [yearsExperience, setYearsExperience] = useState(3);
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [skills, setSkills] = useState('');
  const [notes, setNotes] = useState('');

  // Step 3: Source & type
  const [source, setSource] = useState('manual');
  const [poolType, setPoolType] = useState('active');
  const [referrerName, setReferrerName] = useState('');

  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const isStep1Valid = firstName.trim() && lastName.trim() && email.trim();
  // Anything typed, or a choice changed from its default, is work that closing would lose.
  const dirty = Boolean(
    firstName ||
    lastName ||
    email ||
    phone ||
    location ||
    currentTitle ||
    currentCompany ||
    linkedinUrl ||
    skills ||
    notes ||
    referrerName ||
    yearsExperience !== 3 ||
    source !== 'manual' ||
    poolType !== 'active',
  );

  // A duplicate email belongs to step 1: take the user back to the field it concerns.
  useEffect(() => {
    if (errorCode === 'CONFLICT') setStep(1);
  }, [errorCode]);
  const emailError = errorCode === 'CONFLICT' ? t.candidates.emailTaken : undefined;
  const generalError = errorCode && errorCode !== 'CONFLICT' ? t.candidates.createError : undefined;

  const handleCancel = () => (dirty ? setConfirmingCancel(true) : onClose());

  const handleSubmit = () => {
    if (!isStep1Valid) return;
    onConfirm({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      phone: phone.trim() || undefined,
      source,
      poolType,
      location: location.trim() || undefined,
      currentTitle: currentTitle.trim() || undefined,
      currentCompany: currentCompany.trim() || undefined,
      yearsExperience: yearsExperience || undefined,
      linkedinUrl: linkedinUrl.trim() || undefined,
      skills: skills.trim()
        ? skills
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined,
      notes: notes.trim()
        ? `${notes.trim()}${referrerName.trim() ? `\nReferido por: ${referrerName.trim()}` : ''}`
        : referrerName.trim()
          ? `Referido por: ${referrerName.trim()}`
          : undefined,
    });
  };

  const stepLabels = [t.candidates.stepPersonal, t.candidates.stepProfessional, t.candidates.stepSource];

  return (
    <Modal
      title={t.candidates.createTitle}
      onClose={onClose}
      size="lg"
      dirty={dirty}
      footer={
        <>
          {step > 1 && (
            <Button variant="tertiary" onClick={() => setStep((step - 1) as Step)} className="sm:mr-auto">
              {t.candidates.wizardBack}
            </Button>
          )}
          <Button variant="secondary" onClick={handleCancel}>
            {t.common.cancel}
          </Button>
          {step < 3 ? (
            <Button onClick={() => setStep((step + 1) as Step)} disabled={step === 1 && !isStep1Valid}>
              {t.candidates.wizardNext}
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={!isStep1Valid} loading={isPending} loadingLabel={t.common.saving}>
              {t.candidates.createSubmit}
            </Button>
          )}
        </>
      }
    >
      <Stepper steps={stepLabels} current={step - 1} className="mb-5" />

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
          emailError={emailError}
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

      {/* Step 3: Source & Classification */}
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
          location={location}
          skills={skills}
        />
      )}

      {generalError && (
        <p role="alert" className="mt-4 rounded-lg bg-danger-bg px-3 py-2 text-callout text-danger">
          {generalError}
        </p>
      )}

      {confirmingCancel && (
        <DiscardChangesPrompt onKeepEditing={() => setConfirmingCancel(false)} onDiscard={onClose} />
      )}
    </Modal>
  );
}
