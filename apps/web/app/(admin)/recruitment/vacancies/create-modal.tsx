'use client';

import { useState } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { Modal } from '../../../../components';

interface VacancyFormData {
  title: string;
  description?: string;
  positions: number;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  contractType?: string;
  location?: string;
  remotePolicy?: 'onsite' | 'remote' | 'hybrid';
  salary?: { min?: number; max?: number; currency: string; period: 'monthly' | 'yearly' };
  settings?: { slaTargetDays?: number; autoPublish?: boolean; requireApproval?: boolean };
}

interface CreateModalProps {
  onConfirm: (data: VacancyFormData) => void;
  onClose: () => void;
  isPending: boolean;
}

type Step = 1 | 2 | 3;

const CONTRACT_TYPES = [
  { value: 'indefinido', label: 'Termino indefinido' },
  { value: 'termino_fijo', label: 'Termino fijo' },
  { value: 'obra_labor', label: 'Obra o labor' },
  { value: 'prestacion', label: 'Prestacion de servicios' },
  { value: 'temporal', label: 'Temporal' },
  { value: 'practicas', label: 'Practicas / Pasantia' },
];

const inputCls = 'w-full h-10 px-3 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 focus:border-[#1F114C]';
const labelCls = 'block text-xs font-medium text-[#585858] mb-1';
const textareaCls = 'w-full px-3 py-2 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 focus:border-[#1F114C] resize-none';

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
    <Modal title="Crear nueva vacante" onClose={onClose} maxWidth="max-w-2xl">
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

      {/* Step 1: Basic Info */}
      {step === 1 && (
        <div className="space-y-4">
          <div>
            <label className={labelCls}>Titulo del cargo *</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej: Senior Software Engineer" maxLength={200} className={inputCls} autoFocus />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Ubicacion</label>
              <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Bogota, Colombia" maxLength={200} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Modalidad de trabajo</label>
              <div className="flex bg-[#F6F6F6] rounded-lg overflow-hidden h-10">
                {(['onsite', 'hybrid', 'remote'] as const).map((opt) => (
                  <button key={opt} type="button" onClick={() => setRemotePolicy(opt)}
                    className={`flex-1 text-[12px] font-medium transition ${remotePolicy === opt ? 'bg-[#1F114C] text-white' : 'text-[#585858]'}`}>
                    {opt === 'onsite' ? 'Presencial' : opt === 'hybrid' ? 'Hibrido' : 'Remoto'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Tipo de contrato</label>
              <select value={contractType} onChange={(e) => setContractType(e.target.value)} className={`${inputCls} bg-white`}>
                {CONTRACT_TYPES.map((ct) => <option key={ct.value} value={ct.value}>{ct.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Posiciones</label>
              <input type="number" value={positions} onChange={(e) => setPositions(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))} min={1} max={100} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Prioridad</label>
              <div className="flex bg-[#F6F6F6] rounded-lg overflow-hidden h-10">
                {(['low', 'medium', 'high', 'urgent'] as const).map((p) => (
                  <button key={p} type="button" onClick={() => setPriority(p)}
                    className={`flex-1 text-[11px] font-medium transition ${
                      priority === p
                        ? p === 'urgent' ? 'bg-[#DD0C15] text-white' : 'bg-[#1F114C] text-white'
                        : 'text-[#585858]'
                    }`}>
                    {p === 'low' ? 'Baja' : p === 'medium' ? 'Media' : p === 'high' ? 'Alta' : 'Urgente'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Step 2: Description */}
      {step === 2 && (
        <div className="space-y-4">
          <div>
            <label className={labelCls}>Sobre el cargo</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descripcion general del cargo, proposito y contexto del equipo..." maxLength={2000} rows={3} className={textareaCls} autoFocus />
          </div>
          <div>
            <label className={labelCls}>Responsabilidades clave</label>
            <textarea value={responsibilities} onChange={(e) => setResponsibilities(e.target.value)} placeholder="- Disenar y desarrollar soluciones escalables&#10;- Liderar revisiones de codigo&#10;- Colaborar con equipo de producto" maxLength={2000} rows={4} className={textareaCls} />
            <p className="text-[10px] text-[#8B8B8B] mt-1">Usa una linea por responsabilidad</p>
          </div>
          <div>
            <label className={labelCls}>Requisitos minimos</label>
            <textarea value={requirements} onChange={(e) => setRequirements(e.target.value)} placeholder="- 5+ anos de experiencia en desarrollo de software&#10;- Ingenieria de Sistemas o afines&#10;- Ingles B2+" maxLength={2000} rows={3} className={textareaCls} />
          </div>
          <div>
            <label className={labelCls}>Cualificaciones deseadas</label>
            <textarea value={desiredQualifications} onChange={(e) => setDesiredQualifications(e.target.value)} placeholder="- Experiencia con AWS/GCP&#10;- Certificaciones relevantes&#10;- Experiencia en startups" maxLength={2000} rows={2} className={textareaCls} />
          </div>
          <div>
            <label className={labelCls}>Beneficios</label>
            <textarea value={benefits} onChange={(e) => setBenefits(e.target.value)} placeholder="- Plan de salud prepagada&#10;- Horario flexible&#10;- Presupuesto de capacitacion&#10;- Home office stipend" maxLength={1500} rows={3} className={textareaCls} />
          </div>
        </div>
      )}

      {/* Step 3: Compensation & Settings */}
      {step === 3 && (
        <div className="space-y-5">
          <div>
            <p className="text-[13px] font-medium text-[#1F114C] mb-3">Rango salarial</p>
            <div className="grid grid-cols-4 gap-3">
              <div>
                <label className={labelCls}>Minimo</label>
                <input type="number" value={salaryMin} onChange={(e) => setSalaryMin(e.target.value)} placeholder="8,000,000" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Maximo</label>
                <input type="number" value={salaryMax} onChange={(e) => setSalaryMax(e.target.value)} placeholder="14,000,000" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Moneda</label>
                <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={`${inputCls} bg-white`}>
                  <option value="COP">COP</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="MXN">MXN</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Periodo</label>
                <select value={salaryPeriod} onChange={(e) => setSalaryPeriod(e.target.value as 'monthly' | 'yearly')} className={`${inputCls} bg-white`}>
                  <option value="monthly">Mensual</option>
                  <option value="yearly">Anual</option>
                </select>
              </div>
            </div>
            {salaryMin && salaryMax && (
              <p className="text-[11px] text-[#8B8B8B] mt-2">
                {currency} {parseInt(salaryMin).toLocaleString()} — {parseInt(salaryMax).toLocaleString()} / {salaryPeriod === 'monthly' ? 'mes' : 'ano'}
              </p>
            )}
          </div>

          <div className="border-t border-[#EDEDED] pt-4">
            <p className="text-[13px] font-medium text-[#1F114C] mb-3">Configuracion del proceso</p>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div>
                <label className={labelCls}>SLA objetivo (dias)</label>
                <input type="number" value={slaTargetDays} onChange={(e) => setSlaTargetDays(e.target.value)} min={1} max={365} className={inputCls} />
              </div>
            </div>
            <div className="space-y-3">
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={requireApproval} onChange={(e) => setRequireApproval(e.target.checked)}
                  className="w-4 h-4 rounded border-[#EDEDED] text-[#1F114C] focus:ring-[#1F114C]/20" />
                <div>
                  <span className="text-[13px] text-[#333]">Requiere aprobacion</span>
                  <p className="text-[10px] text-[#8B8B8B]">La vacante debe ser aprobada antes de publicarse</p>
                </div>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={autoPublish} onChange={(e) => setAutoPublish(e.target.checked)}
                  className="w-4 h-4 rounded border-[#EDEDED] text-[#1F114C] focus:ring-[#1F114C]/20" />
                <div>
                  <span className="text-[13px] text-[#333]">Publicar automaticamente</span>
                  <p className="text-[10px] text-[#8B8B8B]">Publicar en portal de empleo al ser aprobada</p>
                </div>
              </label>
            </div>
          </div>

          {/* Summary preview */}
          <div className="border-t border-[#EDEDED] pt-4">
            <p className="text-[13px] font-medium text-[#1F114C] mb-2">Resumen</p>
            <div className="bg-[#F6F6F6] rounded-lg p-3 space-y-1.5">
              <div className="flex justify-between">
                <span className="text-[12px] text-[#585858]">Cargo:</span>
                <span className="text-[12px] text-[#333] font-medium">{title}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[12px] text-[#585858]">Ubicacion:</span>
                <span className="text-[12px] text-[#333]">{location || '—'} ({remotePolicy === 'onsite' ? 'Presencial' : remotePolicy === 'hybrid' ? 'Hibrido' : 'Remoto'})</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[12px] text-[#585858]">Contrato:</span>
                <span className="text-[12px] text-[#333]">{CONTRACT_TYPES.find((c) => c.value === contractType)?.label} · {positions} posicion(es)</span>
              </div>
              {(salaryMin || salaryMax) && (
                <div className="flex justify-between">
                  <span className="text-[12px] text-[#585858]">Salario:</span>
                  <span className="text-[12px] text-[#333]">{currency} {salaryMin ? parseInt(salaryMin).toLocaleString() : '?'} — {salaryMax ? parseInt(salaryMax).toLocaleString() : '?'}</span>
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
