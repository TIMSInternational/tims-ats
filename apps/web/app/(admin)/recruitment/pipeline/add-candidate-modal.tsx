'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { Modal } from '../../../../components';

interface AddCandidateModalProps {
  vacancyId: string;
  vacancyTitle: string;
  onClose: () => void;
  onSuccess: () => void;
}

const SOURCES = [
  { value: 'manual', label: 'Ingreso manual' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'referral', label: 'Referido' },
  { value: 'portal', label: 'Portal' },
  { value: 'job_board', label: 'Job Board' },
  { value: 'university', label: 'Universidad' },
];

export function AddCandidateModal({ vacancyId, vacancyTitle, onClose, onSuccess }: AddCandidateModalProps) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [source, setSource] = useState('manual');
  const [currentTitle, setCurrentTitle] = useState('');
  const [currentCompany, setCurrentCompany] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [step, setStep] = useState<'form' | 'creating' | 'applying'>('form');

  const createCandidate = trpc.candidate.create.useMutation();
  const applyToVacancy = trpc.candidate.applyToVacancy.useMutation();

  const isValid = firstName.trim() && lastName.trim() && email.trim();
  const isPending = step !== 'form';

  const handleSubmit = async () => {
    if (!isValid) return;

    try {
      // Step 1: Create candidate
      setStep('creating');
      const candidate = await createCandidate.mutateAsync({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        source,
        poolType: 'active',
        currentTitle: currentTitle.trim() || undefined,
        currentCompany: currentCompany.trim() || undefined,
        linkedinUrl: linkedinUrl.trim() || undefined,
      });

      // Step 2: Apply candidate to vacancy (adds to first pipeline stage)
      setStep('applying');
      await applyToVacancy.mutateAsync({
        candidateId: candidate.id,
        vacancyId,
        source,
      });

      toast(`${firstName} ${lastName} agregado al pipeline`, { type: 'success' });
      onSuccess();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al agregar candidato';
      toast(msg, { type: 'error' });
      setStep('form');
    }
  };

  const inputClass = 'w-full h-10 px-3 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 focus:border-[#1F114C]';
  const labelClass = 'block text-xs font-medium text-[#585858] mb-1';

  return (
    <Modal title="Agregar Candidato al Pipeline" onClose={onClose} maxWidth="max-w-xl">
      {/* Vacancy indicator */}
      <div className="flex items-center gap-2 bg-[#F0EEF5] rounded-lg px-3 py-2 mb-4">
        <svg className="w-4 h-4 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
          <rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a4 4 0 00-8 0v2" />
        </svg>
        <span className="text-[12px] text-[#1F114C] font-medium">{vacancyTitle}</span>
        <span className="text-[10px] text-[#8B8B8B] ml-auto">Se agregara a la primera etapa</span>
      </div>

      <div className="space-y-4">
        {/* Row 1: Name */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Nombre *</label>
            <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} maxLength={120} className={inputClass} placeholder="Maria" autoFocus disabled={isPending} />
          </div>
          <div>
            <label className={labelClass}>Apellido *</label>
            <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} maxLength={120} className={inputClass} placeholder="Lopez" disabled={isPending} />
          </div>
        </div>

        {/* Row 2: Contact */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Email *</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} className={inputClass} placeholder="maria@example.com" disabled={isPending} />
          </div>
          <div>
            <label className={labelClass}>Telefono</label>
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} className={inputClass} placeholder="+57 310 123 4567" disabled={isPending} />
          </div>
        </div>

        {/* Row 3: Source + Title */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Fuente</label>
            <select value={source} onChange={(e) => setSource(e.target.value)} className={`${inputClass} bg-white`} disabled={isPending}>
              {SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass}>Cargo actual</label>
            <input type="text" value={currentTitle} onChange={(e) => setCurrentTitle(e.target.value)} maxLength={200} className={inputClass} placeholder="Software Engineer" disabled={isPending} />
          </div>
        </div>

        {/* Row 4: Company + LinkedIn */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Empresa actual</label>
            <input type="text" value={currentCompany} onChange={(e) => setCurrentCompany(e.target.value)} maxLength={200} className={inputClass} placeholder="Rappi" disabled={isPending} />
          </div>
          <div>
            <label className={labelClass}>LinkedIn</label>
            <input type="url" value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} maxLength={2048} className={inputClass} placeholder="https://linkedin.com/in/..." disabled={isPending} />
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between mt-6">
        <div className="text-[11px] text-[#8B8B8B]">
          {step === 'creating' && (
            <span className="flex items-center gap-1.5">
              <div className="w-3 h-3 border-2 border-[#1F114C]/30 border-t-[#1F114C] rounded-full animate-spin" />
              Creando candidato...
            </span>
          )}
          {step === 'applying' && (
            <span className="flex items-center gap-1.5">
              <div className="w-3 h-3 border-2 border-[#1F114C]/30 border-t-[#1F114C] rounded-full animate-spin" />
              Agregando al pipeline...
            </span>
          )}
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} disabled={isPending} className="h-9 px-4 rounded-lg border border-[#EDEDED] text-sm text-[#585858] hover:bg-[#F6F6F6] transition disabled:opacity-50">
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={!isValid || isPending}
            className="h-9 px-5 rounded-lg bg-[#DD0C15] text-white text-sm font-medium hover:bg-[#c00b13] transition disabled:opacity-50 flex items-center gap-2"
          >
            {isPending ? 'Procesando...' : 'Agregar al Pipeline'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
