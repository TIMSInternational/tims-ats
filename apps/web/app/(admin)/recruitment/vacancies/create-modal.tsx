'use client';

import { useState } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { Modal } from '../../../../components';
import { Step1BasicInfo, Step2Description, Step3Compensation } from './create-modal.fields';
import type { Step, VacancyFormData } from './create-modal.helpers';

interface CreateModalProps {
  onConfirm: (data: VacancyFormData) => void;
  onClose: () => void;
  isPending: boolean;
}

export function CreateModal({ onConfirm, onClose, isPending }: CreateModalProps) {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>(1);

  // Step 1: Basic info
  const [title, setTitle] = useState('');
  const [positions, setPositions] = useState(1);
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium');
  const [contractType, setContractType] = useState('indefinido');
  const [location, setLocation] = useState('');
  const [remotePolicy, setRemotePolicy] = useState<'onsite' | 'remote' | 'hybrid'>('hybrid');

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

  // Step 3: Compensation & settings
  const [salaryMin, setSalaryMin] = useState('');
  const [salaryMax, setSalaryMax] = useState('');
  const [currency, setCurrency] = useState('COP');
  const [salaryPeriod, setSalaryPeriod] = useState<'monthly' | 'yearly'>('monthly');
  const [slaTargetDays, setSlaTargetDays] = useState('30');
  const [autoPublish, setAutoPublish] = useState(false);
  const [requireApproval, setRequireApproval] = useState(true);

  const isStep1Valid = title.trim().length > 0;

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
    if (!isStep1Valid) return;
    const salary = (salaryMin || salaryMax) ? {
      min: salaryMin ? parseInt(salaryMin) : undefined,
      max: salaryMax ? parseInt(salaryMax) : undefined,
      currency,
      period: salaryPeriod,
    } : undefined;

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
      settings: {
        slaTargetDays: parseInt(slaTargetDays) || 30,
        autoPublish,
        requireApproval,
      },
    });
  };

  const stepLabels = ['Informacion basica', 'Descripcion del cargo', 'Compensacion y ajustes'];

  return (
    <Modal title={t.vacancies.createNewVacancy} onClose={onClose} maxWidth="max-w-2xl">
      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-6">
        {stepLabels.map((label, i) => (
          <div key={i} className="flex items-center gap-2 flex-1">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${
              step > i + 1 ? 'bg-green-500 text-white' :
              step === i + 1 ? 'bg-[#1F114C] text-white' :
              'bg-[#EDEDED] text-[#8B8B8B]'
            }`}>
              {step > i + 1 ? '✓' : i + 1}
            </div>
            <span className={`text-[11px] ${step === i + 1 ? 'text-[#1F114C] font-medium' : 'text-[#8B8B8B]'}`}>{label}</span>
            {i < 2 && <div className={`flex-1 h-[1px] ${step > i + 1 ? 'bg-green-500' : 'bg-[#EDEDED]'}`} />}
          </div>
        ))}
      </div>

      {step === 1 && (
        <Step1BasicInfo
          title={title} setTitle={setTitle}
          location={location} setLocation={setLocation}
          remotePolicy={remotePolicy} setRemotePolicy={setRemotePolicy}
          contractType={contractType} setContractType={setContractType}
          positions={positions} setPositions={setPositions}
          priority={priority} setPriority={setPriority}
        />
      )}

      {step === 2 && (
        <Step2Description
          title={title} location={location}
          description={description} setDescription={setDescription}
          responsibilities={responsibilities} setResponsibilities={setResponsibilities}
          requirements={requirements} setRequirements={setRequirements}
          desiredQualifications={desiredQualifications} setDesiredQualifications={setDesiredQualifications}
          benefits={benefits} setBenefits={setBenefits}
          setSocialDescription={setSocialDescription}
          setWhatsappDescription={setWhatsappDescription}
        />
      )}

      {step === 3 && (
        <Step3Compensation
          salaryMin={salaryMin} setSalaryMin={setSalaryMin}
          salaryMax={salaryMax} setSalaryMax={setSalaryMax}
          currency={currency} setCurrency={setCurrency}
          salaryPeriod={salaryPeriod} setSalaryPeriod={setSalaryPeriod}
          slaTargetDays={slaTargetDays} setSlaTargetDays={setSlaTargetDays}
          autoPublish={autoPublish} setAutoPublish={setAutoPublish}
          requireApproval={requireApproval} setRequireApproval={setRequireApproval}
          title={title} location={location} remotePolicy={remotePolicy}
          contractType={contractType} positions={positions}
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
              className="h-9 px-5 rounded-lg bg-[#DD0C15] text-white text-sm font-medium hover:bg-[#c00b13] transition disabled:opacity-50"
            >
              {isPending ? 'Creando...' : 'Crear vacante'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
