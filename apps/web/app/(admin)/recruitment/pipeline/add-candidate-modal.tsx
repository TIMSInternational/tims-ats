'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { Modal } from '../../../../components';
import { Step1Fields, Step2Fields, Step3Fields } from './add-candidate-modal.fields';
import type { Step, ProcessStep } from './add-candidate-modal.helpers';
import { STEP_LABELS } from './add-candidate-modal.helpers';

interface AddCandidateModalProps {
  vacancyId: string;
  vacancyTitle: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function AddCandidateModal({ vacancyId, vacancyTitle, onClose, onSuccess }: AddCandidateModalProps) {
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
          skills: skills.trim() ? skills.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
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
            toast(`${firstName} ${lastName} ya existe — agregando a la vacante`, { type: 'info' });
          } else {
            throw new Error('Candidato con este email ya existe pero no se pudo encontrar');
          }
        } else {
          throw createErr;
        }
      }

      setProcessStep('applying');
      await applyToVacancy.mutateAsync({ candidateId, vacancyId, source });

      toast(`${firstName} ${lastName} agregado al pipeline`, { type: 'success' });
      onSuccess();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al agregar candidato';
      if (msg.includes('unique') || msg.includes('Unique') || msg.includes('already')) {
        toast('Este candidato ya esta aplicando a esta vacante', { type: 'error' });
      } else {
        toast(msg, { type: 'error' });
      }
      setProcessStep('idle');
    }
  };

  return (
    <Modal title="Agregar Candidato al Pipeline" onClose={onClose} maxWidth="max-w-2xl">
      {/* Vacancy badge */}
      <div className="flex items-center gap-2 bg-[#F0EEF5] rounded-lg px-3 py-2.5 mb-5">
        <svg className="w-4 h-4 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
          <rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a4 4 0 00-8 0v2" />
        </svg>
        <span className="text-[12px] text-[#1F114C] font-medium">{vacancyTitle}</span>
        <span className="text-[10px] text-[#8B8B8B] ml-auto">Se agregara a la primera etapa</span>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-6">
        {STEP_LABELS.map((label, i) => (
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

      {/* Navigation */}
      <div className="flex items-center justify-between mt-6 pt-4 border-t border-[#EDEDED]">
        <div>
          {step > 1 && !isPending && (
            <button onClick={() => setStep((step - 1) as Step)} className="text-[12px] text-[#585858] hover:text-[#1F114C] transition flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
              Anterior
            </button>
          )}
          {isPending && (
            <span className="flex items-center gap-1.5 text-[11px] text-[#8B8B8B]">
              <div className="w-3 h-3 border-2 border-[#1F114C]/30 border-t-[#1F114C] rounded-full animate-spin" />
              {processStep === 'creating' ? 'Creando candidato...' : 'Agregando al pipeline...'}
            </span>
          )}
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} disabled={isPending} className="h-9 px-4 rounded-lg border border-[#EDEDED] text-sm text-[#585858] hover:bg-[#F6F6F6] transition disabled:opacity-50">
            Cancelar
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
              className="h-9 px-5 rounded-lg bg-[#DD0C15] text-white text-sm font-medium hover:bg-[#c00b13] transition disabled:opacity-50 flex items-center gap-2"
            >
              {isPending ? 'Procesando...' : 'Agregar al Pipeline'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
