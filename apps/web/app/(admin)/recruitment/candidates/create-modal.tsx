'use client';

import { useState } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { Modal } from '../../../../components';

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

type Step = 1 | 2 | 3;

const SOURCES = [
  { value: 'manual', label: 'Ingreso manual' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'referral', label: 'Referido' },
  { value: 'portal', label: 'Portal de empleo' },
  { value: 'job_board', label: 'Job Board' },
  { value: 'university', label: 'Universidad' },
  { value: 'internal', label: 'Interno / Transferencia' },
];

const POOL_TYPES = [
  { value: 'active', label: 'Activo — busca empleo activamente' },
  { value: 'passive', label: 'Pasivo — no busca pero abierto a ofertas' },
  { value: 'referral', label: 'Referido por un empleado' },
  { value: 'sourced', label: 'Sourced — contactado directamente' },
];

const EXPERIENCE_LEVELS = [
  { value: 0, label: 'Sin experiencia' },
  { value: 1, label: '1 ano' },
  { value: 2, label: '2 anos' },
  { value: 3, label: '3-4 anos' },
  { value: 5, label: '5-7 anos' },
  { value: 8, label: '8-10 anos' },
  { value: 12, label: '10+ anos' },
];

const inputCls = 'w-full h-10 px-3 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 focus:border-[#1F114C]';
const labelCls = 'block text-xs font-medium text-[#585858] mb-1';
const textareaCls = 'w-full px-3 py-2 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 focus:border-[#1F114C] resize-none';

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
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>{t.candidates.firstName} *</label>
              <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} maxLength={120} className={inputCls} placeholder="Maria" autoFocus />
            </div>
            <div>
              <label className={labelCls}>{t.candidates.lastName} *</label>
              <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} maxLength={120} className={inputCls} placeholder="Lopez Rodriguez" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>{t.candidates.email} *</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} className={inputCls} placeholder="maria.lopez@gmail.com" />
            </div>
            <div>
              <label className={labelCls}>{t.candidates.phone}</label>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} className={inputCls} placeholder="+57 310 123 4567" />
            </div>
          </div>
          <div>
            <label className={labelCls}>{t.candidates.location}</label>
            <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={200} className={inputCls} placeholder="Bogota, Colombia" />
          </div>
        </div>
      )}

      {/* Step 2: Professional Profile */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>{t.candidates.currentTitle}</label>
              <input type="text" value={currentTitle} onChange={(e) => setCurrentTitle(e.target.value)} maxLength={200} className={inputCls} placeholder="Senior Software Engineer" />
            </div>
            <div>
              <label className={labelCls}>{t.candidates.currentCompany}</label>
              <input type="text" value={currentCompany} onChange={(e) => setCurrentCompany(e.target.value)} maxLength={200} className={inputCls} placeholder="MercadoLibre" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Anos de experiencia</label>
              <select value={yearsExperience} onChange={(e) => setYearsExperience(parseInt(e.target.value))} className={`${inputCls} bg-white`}>
                {EXPERIENCE_LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>{t.candidates.linkedinUrl}</label>
              <input type="url" value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} maxLength={2048} className={inputCls} placeholder="https://linkedin.com/in/maria-lopez" />
            </div>
          </div>
          <div>
            <label className={labelCls}>Habilidades clave</label>
            <input type="text" value={skills} onChange={(e) => setSkills(e.target.value)} maxLength={500} className={inputCls} placeholder="React, TypeScript, Node.js, AWS (separadas por coma)" />
            <p className="text-[10px] text-[#8B8B8B] mt-1">Separa cada habilidad con una coma</p>
          </div>
          <div>
            <label className={labelCls}>Notas del reclutador</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={5000} rows={3} className={textareaCls} placeholder="Observaciones, como fue contactado, impresiones iniciales..." />
          </div>
        </div>
      )}

      {/* Step 3: Source & Classification */}
      {step === 3 && (
        <div className="space-y-5">
          <div>
            <p className="text-[13px] font-medium text-[#1F114C] mb-3">Como llego este candidato?</p>
            <div className="grid grid-cols-2 gap-2">
              {SOURCES.map((s) => (
                <button key={s.value} type="button" onClick={() => setSource(s.value)}
                  className={`text-left px-3 py-2.5 rounded-lg border text-[12px] transition ${
                    source === s.value ? 'border-[#1F114C] bg-[#F0EEF5] text-[#1F114C] font-medium' : 'border-[#EDEDED] text-[#585858] hover:bg-[#F6F6F6]'
                  }`}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {source === 'referral' && (
            <div>
              <label className={labelCls}>Nombre del referente</label>
              <input type="text" value={referrerName} onChange={(e) => setReferrerName(e.target.value)} maxLength={200} className={inputCls} placeholder="Juan Perez (Equipo Tecnologia)" />
            </div>
          )}

          <div>
            <p className="text-[13px] font-medium text-[#1F114C] mb-3">Clasificacion del candidato</p>
            <div className="space-y-2">
              {POOL_TYPES.map((p) => (
                <label key={p.value}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition ${
                    poolType === p.value ? 'border-[#1F114C] bg-[#F0EEF5]' : 'border-[#EDEDED] hover:bg-[#F6F6F6]'
                  }`}>
                  <input type="radio" name="poolType" value={p.value} checked={poolType === p.value}
                    onChange={(e) => setPoolType(e.target.value)} className="w-4 h-4 text-[#1F114C] focus:ring-[#1F114C]/20" />
                  <span className={`text-[12px] ${poolType === p.value ? 'text-[#1F114C] font-medium' : 'text-[#585858]'}`}>{p.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Summary */}
          <div className="border-t border-[#EDEDED] pt-4">
            <p className="text-[13px] font-medium text-[#1F114C] mb-2">Resumen</p>
            <div className="bg-[#F6F6F6] rounded-lg p-3 space-y-1.5">
              <div className="flex justify-between">
                <span className="text-[12px] text-[#585858]">Nombre:</span>
                <span className="text-[12px] text-[#333] font-medium">{firstName} {lastName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[12px] text-[#585858]">Email:</span>
                <span className="text-[12px] text-[#333]">{email}</span>
              </div>
              {currentTitle && (
                <div className="flex justify-between">
                  <span className="text-[12px] text-[#585858]">Cargo:</span>
                  <span className="text-[12px] text-[#333]">{currentTitle}{currentCompany ? ` en ${currentCompany}` : ''}</span>
                </div>
              )}
              {location && (
                <div className="flex justify-between">
                  <span className="text-[12px] text-[#585858]">Ubicacion:</span>
                  <span className="text-[12px] text-[#333]">{location}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-[12px] text-[#585858]">Fuente:</span>
                <span className="text-[12px] text-[#333]">{SOURCES.find((s) => s.value === source)?.label}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[12px] text-[#585858]">Tipo:</span>
                <span className="text-[12px] text-[#333]">{POOL_TYPES.find((p) => p.value === poolType)?.label?.split(' — ')[0]}</span>
              </div>
              {skills.trim() && (
                <div className="flex justify-between">
                  <span className="text-[12px] text-[#585858]">Skills:</span>
                  <span className="text-[12px] text-[#333]">{skills.split(',').slice(0, 4).map((s) => s.trim()).join(', ')}{skills.split(',').length > 4 ? '...' : ''}</span>
                </div>
              )}
            </div>
          </div>
        </div>
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
