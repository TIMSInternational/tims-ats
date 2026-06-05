'use client';

import {
  SOURCES,
  POOL_TYPES,
  EXPERIENCE_LEVELS,
  inputCls,
  labelCls,
  textareaCls,
} from './add-candidate-modal.helpers';

interface Step1FieldsProps {
  firstName: string;
  setFirstName: (v: string) => void;
  lastName: string;
  setLastName: (v: string) => void;
  email: string;
  setEmail: (v: string) => void;
  phone: string;
  setPhone: (v: string) => void;
  location: string;
  setLocation: (v: string) => void;
}

export function Step1Fields({
  firstName,
  setFirstName,
  lastName,
  setLastName,
  email,
  setEmail,
  phone,
  setPhone,
  location,
  setLocation,
}: Step1FieldsProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Nombre *</label>
          <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} maxLength={120} className={inputCls} placeholder="Maria" autoFocus />
        </div>
        <div>
          <label className={labelCls}>Apellido *</label>
          <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} maxLength={120} className={inputCls} placeholder="Lopez Rodriguez" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Email *</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} className={inputCls} placeholder="maria.lopez@gmail.com" />
        </div>
        <div>
          <label className={labelCls}>Telefono</label>
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} className={inputCls} placeholder="+57 310 123 4567" />
        </div>
      </div>
      <div>
        <label className={labelCls}>Ubicacion</label>
        <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={200} className={inputCls} placeholder="Bogota, Colombia" />
      </div>
    </div>
  );
}

interface Step2FieldsProps {
  currentTitle: string;
  setCurrentTitle: (v: string) => void;
  currentCompany: string;
  setCurrentCompany: (v: string) => void;
  yearsExperience: string;
  setYearsExperience: (v: string) => void;
  linkedinUrl: string;
  setLinkedinUrl: (v: string) => void;
  skills: string;
  setSkills: (v: string) => void;
  notes: string;
  setNotes: (v: string) => void;
}

export function Step2Fields({
  currentTitle,
  setCurrentTitle,
  currentCompany,
  setCurrentCompany,
  yearsExperience,
  setYearsExperience,
  linkedinUrl,
  setLinkedinUrl,
  skills,
  setSkills,
  notes,
  setNotes,
}: Step2FieldsProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Cargo actual</label>
          <input type="text" value={currentTitle} onChange={(e) => setCurrentTitle(e.target.value)} maxLength={200} className={inputCls} placeholder="Senior Software Engineer" />
        </div>
        <div>
          <label className={labelCls}>Empresa actual</label>
          <input type="text" value={currentCompany} onChange={(e) => setCurrentCompany(e.target.value)} maxLength={200} className={inputCls} placeholder="MercadoLibre" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Anos de experiencia</label>
          <select value={yearsExperience} onChange={(e) => setYearsExperience(e.target.value)} className={`${inputCls} bg-white`}>
            {EXPERIENCE_LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>LinkedIn</label>
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
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} rows={3} className={textareaCls} placeholder="Observaciones relevantes sobre el candidato, como fue contactado, impresiones iniciales..." />
      </div>
    </div>
  );
}

interface Step3FieldsProps {
  source: string;
  setSource: (v: string) => void;
  poolType: string;
  setPoolType: (v: string) => void;
  referrerName: string;
  setReferrerName: (v: string) => void;
  firstName: string;
  lastName: string;
  email: string;
  currentTitle: string;
  currentCompany: string;
  skills: string;
  vacancyTitle: string;
}

export function Step3Fields({
  source,
  setSource,
  poolType,
  setPoolType,
  referrerName,
  setReferrerName,
  firstName,
  lastName,
  email,
  currentTitle,
  currentCompany,
  skills,
  vacancyTitle,
}: Step3FieldsProps) {
  return (
    <div className="space-y-5">
      <div>
        <p className="text-[13px] font-medium text-[#1F114C] mb-3">Como llego este candidato?</p>
        <div className="grid grid-cols-2 gap-2">
          {SOURCES.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => setSource(s.value)}
              className={`text-left px-3 py-2.5 rounded-lg border text-[12px] transition ${
                source === s.value
                  ? 'border-[#1F114C] bg-[#F0EEF5] text-[#1F114C] font-medium'
                  : 'border-[#EDEDED] text-[#585858] hover:bg-[#F6F6F6]'
              }`}
            >
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
        <p className="text-[13px] font-medium text-[#1F114C] mb-3">Tipo de candidato</p>
        <div className="space-y-2">
          {POOL_TYPES.map((p) => (
            <label
              key={p.value}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition ${
                poolType === p.value
                  ? 'border-[#1F114C] bg-[#F0EEF5]'
                  : 'border-[#EDEDED] hover:bg-[#F6F6F6]'
              }`}
            >
              <input
                type="radio"
                name="poolType"
                value={p.value}
                checked={poolType === p.value}
                onChange={(e) => setPoolType(e.target.value)}
                className="w-4 h-4 text-[#1F114C] focus:ring-[#1F114C]/20"
              />
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
            <span className="text-[12px] text-[#585858]">Candidato:</span>
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
          <div className="flex justify-between">
            <span className="text-[12px] text-[#585858]">Fuente:</span>
            <span className="text-[12px] text-[#333]">{SOURCES.find((s) => s.value === source)?.label}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[12px] text-[#585858]">Vacante:</span>
            <span className="text-[12px] text-[#333]">{vacancyTitle}</span>
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
  );
}
