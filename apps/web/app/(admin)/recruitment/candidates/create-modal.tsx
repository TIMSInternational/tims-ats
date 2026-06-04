'use client';

import { useState } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { Modal } from '../../../../components';
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
}

export function CreateModal({ onConfirm, onClose, isPending }: CreateModalProps) {
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

  const isStep1Valid = firstName.trim() && lastName.trim() && email.trim();

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
      skills: skills.trim() ? skills.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
      notes: notes.trim() ? `${notes.trim()}${referrerName.trim() ? `\nReferido por: ${referrerName.trim()}` : ''}` : referrerName.trim() ? `Referido por: ${referrerName.trim()}` : undefined,
    });
  };

  const stepLabels = ['Datos personales', 'Perfil profesional', 'Fuente y clasificacion'];

  return (
    <Modal title={t.candidates.createTitle} onClose={onClose} maxWidth="max-w-2xl">
      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-6">
        {stepLabels.map((label, i) => (
          <div key={i} className="flex items-center gap-2 flex-1">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${
              step > i + 1 ? 'bg-green-500 text-white' : step === i + 1 ? 'bg-[#1F114C] text-white' : 'bg-[#EDEDED] text-[#8B8B8B]'
            }`}>
              {step > i + 1 ? '✓' : i + 1}
            </div>
            <span className={`text-[11px] ${step === i + 1 ? 'text-[#1F114C] font-medium' : 'text-[#8B8B8B]'}`}>{label}</span>
            {i < 2 && <div className={`flex-1 h-[1px] ${step > i + 1 ? 'bg-green-500' : 'bg-[#EDEDED]'}`} />}
          </div>
        ))}
      </div>

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

      {/* Navigation */}
      <div className="flex items-center justify-between mt-6 pt-4 border-t border-[#EDEDED]">
        <div>
          {step > 1 && (
            <button onClick={() => setStep((step - 1) as Step)} className="text-[12px] text-[#585858] hover:text-[#1F114C] transition flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
              Anterior
            </button>
          )}
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} className="h-9 px-4 rounded-lg border border-[#EDEDED] text-sm text-[#585858] hover:bg-[#F6F6F6] transition">
            {t.common.cancel}
          </button>
          {step < 3 ? (
            <button
              onClick={() => setStep((step + 1) as Step)}
              disabled={step === 1 && !isStep1Valid}
              className="h-9 px-5 rounded-lg bg-[#1F114C] text-white text-sm font-medium hover:bg-[#2a1a5c] transition disabled:opacity-50 flex items-center gap-1"
            >
              Siguiente
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!isStep1Valid || isPending}
              className="h-9 px-5 rounded-lg bg-[#DD0C15] text-white text-sm font-medium hover:bg-[#c00b13] transition disabled:opacity-50"
            >
              {isPending ? t.common.saving : t.common.create}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
