'use client';

import { useState } from 'react';
import { trpc } from '../../../../../../lib/trpc';
import { toast } from '../../../../../../lib/toast';
import { Modal } from '../../../../../../components';

interface ApplyModalProps {
  vacancyId: string;
  vacancyTitle: string;
  companyName: string;
  onClose: () => void;
}

type Step = 1 | 2 | 3;

const EXPERIENCE_LEVELS = [
  { value: '', label: 'Seleccionar...' },
  { value: '0', label: 'Sin experiencia' },
  { value: '1', label: '1 ano' },
  { value: '2', label: '2 anos' },
  { value: '3', label: '3-4 anos' },
  { value: '5', label: '5-7 anos' },
  { value: '8', label: '8-10 anos' },
  { value: '12', label: '10+ anos' },
];

const inputCls = 'w-full h-10 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#333] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 focus:border-[#1F114C] disabled:opacity-50 disabled:bg-[#FAFAFA]';
const labelCls = 'block text-xs font-medium text-[#585858] mb-1';
const textareaCls = 'w-full px-3 py-2 rounded-lg border border-[#EDEDED] text-sm text-[#333] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 focus:border-[#1F114C] resize-none disabled:opacity-50';

export function ApplyModal({ vacancyId, vacancyTitle, companyName, onClose }: ApplyModalProps) {
  const [step, setStep] = useState<Step>(1);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [location, setLocation] = useState('');

  const [currentTitle, setCurrentTitle] = useState('');
  const [currentCompany, setCurrentCompany] = useState('');
  const [yearsExperience, setYearsExperience] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [coverLetter, setCoverLetter] = useState('');

  const applyMutation = trpc.portal.applyToVacancy.useMutation();

  const isStep1Valid = firstName.trim() && lastName.trim() && email.trim() && email.includes('@');

  const handleSubmit = async () => {
    if (!isStep1Valid) return;
    try {
      setSubmitting(true);
      await applyMutation.mutateAsync({
        vacancyId,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        location: location.trim() || undefined,
        currentTitle: currentTitle.trim() || undefined,
        currentCompany: currentCompany.trim() || undefined,
        yearsExperience: yearsExperience ? parseInt(yearsExperience) : undefined,
        linkedinUrl: linkedinUrl.trim() || undefined,
        coverLetter: coverLetter.trim() || undefined,
        source: 'portal',
      });
      setSuccess(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al enviar la aplicacion';
      if (msg.includes('unique') || msg.includes('Unique') || msg.includes('already')) {
        toast('Ya aplicaste a esta vacante anteriormente', { type: 'error' });
      } else {
        toast(msg, { type: 'error' });
      }
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <Modal title="" onClose={onClose} maxWidth="max-w-lg">
        <div className="flex flex-col items-center py-6 text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-50">
            <svg className="h-8 w-8 text-green-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h3 className="mb-2 text-[18px] font-bold text-[#1F114C]">Aplicacion enviada</h3>
          <p className="mb-1 text-[14px] text-[#585858]">
            Tu aplicacion a <span className="font-medium text-[#333]">{vacancyTitle}</span> ha sido recibida.
          </p>
          <p className="mb-6 text-[13px] text-[#8B8B8B]">
            El equipo de {companyName} revisara tu perfil y te contactara si avanzas en el proceso.
          </p>
          <button
            onClick={onClose}
            className="h-10 rounded-lg bg-[#1F114C] px-6 text-[13px] font-medium text-white transition-colors hover:bg-[#2a1a5c]"
          >
            Entendido
          </button>
        </div>
      </Modal>
    );
  }

  const stepLabels = ['Datos personales', 'Perfil y motivacion', 'Revisar y enviar'];

  return (
    <Modal title={`Aplicar a ${vacancyTitle}`} onClose={onClose} maxWidth="max-w-2xl">
      {/* Step indicator */}
      <div className="mb-6 flex items-center gap-2">
        {stepLabels.map((label, i) => (
          <div key={i} className="flex flex-1 items-center gap-2">
            <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
              step > i + 1 ? 'bg-green-500 text-white' : step === i + 1 ? 'bg-[#DD0C15] text-white' : 'bg-[#EDEDED] text-[#8B8B8B]'
            }`}>
              {step > i + 1 ? '✓' : i + 1}
            </div>
            <span className={`text-[11px] ${step === i + 1 ? 'font-medium text-[#1F114C]' : 'text-[#8B8B8B]'}`}>{label}</span>
            {i < 2 && <div className={`h-[1px] flex-1 ${step > i + 1 ? 'bg-green-500' : 'bg-[#EDEDED]'}`} />}
          </div>
        ))}
      </div>

      {/* Step 1: Personal Info */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Nombre *</label>
              <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} maxLength={100} className={inputCls} placeholder="Maria" autoFocus />
            </div>
            <div>
              <label className={labelCls}>Apellido *</label>
              <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} maxLength={100} className={inputCls} placeholder="Lopez Rodriguez" />
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
      )}

      {/* Step 2: Professional + Cover Letter */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Cargo actual</label>
              <input type="text" value={currentTitle} onChange={(e) => setCurrentTitle(e.target.value)} maxLength={200} className={inputCls} placeholder="Analista de Recursos Humanos" />
            </div>
            <div>
              <label className={labelCls}>Empresa actual</label>
              <input type="text" value={currentCompany} onChange={(e) => setCurrentCompany(e.target.value)} maxLength={200} className={inputCls} placeholder="Empresa ABC" />
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
              <input type="url" value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} maxLength={2048} className={inputCls} placeholder="https://linkedin.com/in/tu-perfil" />
            </div>
          </div>
          <div>
            <label className={labelCls}>Por que te interesa este puesto?</label>
            <textarea
              value={coverLetter}
              onChange={(e) => setCoverLetter(e.target.value)}
              maxLength={5000}
              rows={5}
              className={textareaCls}
              placeholder="Cuentanos sobre tu experiencia relevante y por que te gustaria trabajar con nosotros..."
            />
            <p className="mt-1 text-right text-[10px] text-[#8B8B8B]">{coverLetter.length}/5000</p>
          </div>
        </div>
      )}

      {/* Step 3: Review & Submit */}
      {step === 3 && (
        <div className="space-y-5">
          <div className="rounded-lg bg-[#F6F6F6] p-4 space-y-2">
            <SummaryRow label="Nombre" value={`${firstName} ${lastName}`} />
            <SummaryRow label="Email" value={email} />
            {phone && <SummaryRow label="Telefono" value={phone} />}
            {location && <SummaryRow label="Ubicacion" value={location} />}
            {currentTitle && <SummaryRow label="Cargo actual" value={`${currentTitle}${currentCompany ? ` en ${currentCompany}` : ''}`} />}
            {yearsExperience && <SummaryRow label="Experiencia" value={EXPERIENCE_LEVELS.find((l) => l.value === yearsExperience)?.label ?? yearsExperience} />}
            {linkedinUrl && <SummaryRow label="LinkedIn" value={linkedinUrl} />}
            <SummaryRow label="Vacante" value={vacancyTitle} />
          </div>

          {coverLetter.trim() && (
            <div>
              <p className="mb-2 text-[12px] font-medium text-[#585858]">Tu mensaje:</p>
              <div className="rounded-lg border border-[#EDEDED] bg-white p-3 text-[13px] leading-relaxed text-[#585858] whitespace-pre-wrap max-h-32 overflow-y-auto">
                {coverLetter}
              </div>
            </div>
          )}

          <p className="text-[11px] text-[#8B8B8B]">
            Al enviar tu aplicacion, aceptas que {companyName} procese tus datos personales con fines de seleccion de personal.
          </p>
        </div>
      )}

      {/* Navigation */}
      <div className="mt-6 flex items-center justify-between border-t border-[#EDEDED] pt-4">
        <div>
          {step > 1 && !submitting && (
            <button onClick={() => setStep((step - 1) as Step)} className="flex items-center gap-1 text-[12px] text-[#585858] transition hover:text-[#1F114C]">
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
              Anterior
            </button>
          )}
          {submitting && (
            <span className="flex items-center gap-1.5 text-[11px] text-[#8B8B8B]">
              <div className="h-3 w-3 animate-spin rounded-full border-2 border-[#DD0C15]/30 border-t-[#DD0C15]" />
              Enviando aplicacion...
            </span>
          )}
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} disabled={submitting} className="h-9 rounded-lg border border-[#EDEDED] px-4 text-sm text-[#585858] transition hover:bg-[#F6F6F6] disabled:opacity-50">
            Cancelar
          </button>
          {step < 3 ? (
            <button
              onClick={() => setStep((step + 1) as Step)}
              disabled={step === 1 && !isStep1Valid}
              className="flex h-9 items-center gap-1 rounded-lg bg-[#1F114C] px-5 text-sm font-medium text-white transition hover:bg-[#2a1a5c] disabled:opacity-50"
            >
              Siguiente
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!isStep1Valid || submitting}
              className="flex h-9 items-center gap-2 rounded-lg bg-[#DD0C15] px-5 text-sm font-medium text-white transition hover:bg-[#c00b13] disabled:opacity-50"
            >
              {submitting ? 'Enviando...' : 'Enviar aplicacion'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-[12px] text-[#585858]">{label}:</span>
      <span className="max-w-[60%] truncate text-right text-[12px] font-medium text-[#333]">{value}</span>
    </div>
  );
}
